#!/usr/bin/env python3
"""
Train a keyword spotter for 7 solfège notes (do ré mi fa sol la si).

Architecture: hand-crafted mel features → tiny MLP
- Runs as pure JS in the browser (no WASM / ORT needed)
- Inference < 1 ms, model loads in < 100 ms

Usage:
    python3 train_model.py

Outputs:
    public/kws_model.json   — weights + feature params for JS worker
"""

import json
import os
import random
import wave

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset

# ── Config ────────────────────────────────────────────────────────────────────

NOTES    = ['do', 're', 'mi', 'fa', 'sol', 'la', 'si']
LABELS   = ['do', 'ré', 'mi', 'fa', 'sol', 'la', 'si']
SR       = 16000
N_FFT    = 512
HOP      = 160      # 10 ms
N_MELS   = 64
N_FRAMES = 100      # 1 second

# Features per mel band: global mean, global std, onset mean (first 20 frames)
N_FEAT   = N_MELS * 3   # 192

SPLIT_DIR = 'training/split'
OUT       = 'public/kws_model.json'

BATCH  = 32
EPOCHS = 120
LR     = 3e-3
SEED   = 42

# ── Mel filterbank ────────────────────────────────────────────────────────────

def _hz2mel(f):  return 2595 * np.log10(1 + f / 700)
def _mel2hz(m):  return 700 * (10 ** (m / 2595) - 1)

def build_filterbank(sr=SR, n_fft=N_FFT, n_mels=N_MELS, fmin=80, fmax=7600):
    mels = np.linspace(_hz2mel(fmin), _hz2mel(fmax), n_mels + 2)
    bins = np.floor((n_fft + 1) * _mel2hz(mels) / sr).astype(int)
    fb   = np.zeros((n_mels, n_fft // 2 + 1), dtype=np.float32)
    for m in range(1, n_mels + 1):
        lo, mid, hi = bins[m-1], bins[m], bins[m+1]
        for k in range(lo, mid):
            if mid > lo: fb[m-1, k] = (k - lo) / (mid - lo)
        for k in range(mid, hi):
            if hi > mid: fb[m-1, k] = (hi - k) / (hi - mid)
    return fb

FILTERBANK = build_filterbank()
WINDOW     = np.hanning(N_FFT).astype(np.float32)

# ── Feature extraction ────────────────────────────────────────────────────────

def load_wav(path):
    with wave.open(path) as wf:
        assert wf.getnchannels() == 1 and wf.getframerate() == SR
        raw = wf.readframes(wf.getnframes())
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def mel_spec(samples):
    need = (N_FRAMES - 1) * HOP + N_FFT
    if len(samples) < need:
        samples = np.pad(samples, (0, need - len(samples)))
    else:
        samples = samples[:need]

    S = np.zeros((N_MELS, N_FRAMES), dtype=np.float32)
    for t in range(N_FRAMES):
        frame  = samples[t * HOP: t * HOP + N_FFT] * WINDOW
        power  = np.abs(np.fft.rfft(frame, n=N_FFT)) ** 2
        S[:, t] = np.log(FILTERBANK @ power + 1e-8)
    return S


def extract_features(samples):
    """
    Returns a 1-D feature vector of length N_FEAT (192).
    Same computation will be reproduced in the JS worker.
      [0  : 64]  global mean  of log-mel over time
      [64 : 128] global std   of log-mel over time
      [128: 192] onset  mean  (first 20 frames ≈ 200 ms)
    """
    S       = mel_spec(samples)             # (64, 100)
    g_mean  = S.mean(axis=1)               # (64,)
    g_std   = S.std(axis=1)                # (64,)
    o_mean  = S[:, :20].mean(axis=1)       # (64,)  — consonant onset

    feat = np.concatenate([g_mean, g_std, o_mean])   # (192,)

    # Per-sample normalisation
    mu  = feat.mean()
    sig = feat.std() + 1e-6
    return (feat - mu) / sig


# ── Augmentation ──────────────────────────────────────────────────────────────

def augment(samples):
    samples = samples * random.uniform(0.5, 1.5)
    shift   = random.randint(-1600, 1600)
    if shift > 0:
        samples = np.concatenate([np.zeros(shift, dtype=np.float32), samples])
    elif shift < 0:
        samples = samples[-shift:]
    samples += np.random.randn(len(samples)).astype(np.float32) * random.uniform(0, 0.008)
    return samples


# ── Dataset ───────────────────────────────────────────────────────────────────

class NoteDS(Dataset):
    def __init__(self, items, do_aug=False):
        self.items  = items
        self.do_aug = do_aug

    def __len__(self): return len(self.items)

    def __getitem__(self, i):
        path, label = self.items[i]
        s = load_wav(path)
        if self.do_aug: s = augment(s)
        f = extract_features(s)
        return torch.tensor(f), label


# ── Model ─────────────────────────────────────────────────────────────────────

class MLP(nn.Module):
    def __init__(self, n_in=N_FEAT, n_classes=7):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_in, 128), nn.BatchNorm1d(128), nn.ReLU(), nn.Dropout(0.3),
            nn.Linear(128,  64),  nn.BatchNorm1d(64),  nn.ReLU(), nn.Dropout(0.2),
            nn.Linear(64,   n_classes),
        )

    def forward(self, x): return self.net(x)


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    random.seed(SEED); np.random.seed(SEED); torch.manual_seed(SEED)

    all_items = []
    print("\nSamples per class:")
    for idx, note in enumerate(NOTES):
        d    = os.path.join(SPLIT_DIR, note)
        wavs = sorted(f for f in os.listdir(d) if f.endswith('.wav'))
        for w in wavs: all_items.append((os.path.join(d, w), idx))
        print(f"  {LABELS[idx]:4s}: {len(wavs)}")

    print(f"\nTotal: {len(all_items)}  —  features: {N_FEAT}")

    random.shuffle(all_items)
    n_val       = max(7, int(len(all_items) * 0.15))
    val_items   = all_items[:n_val]
    train_items = all_items[n_val:]
    print(f"Train: {len(train_items)}  Val: {len(val_items)}\n")

    train_dl = DataLoader(NoteDS(train_items, do_aug=True),  batch_size=BATCH, shuffle=True,  num_workers=4)
    val_dl   = DataLoader(NoteDS(val_items,   do_aug=False), batch_size=BATCH, shuffle=False, num_workers=2)

    model = MLP(n_in=N_FEAT, n_classes=len(NOTES))
    opt   = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=EPOCHS)
    crit  = nn.CrossEntropyLoss()

    best_acc, best_state = 0.0, None

    for ep in range(1, EPOCHS + 1):
        model.train()
        t_ok = t_n = 0
        for X, y in train_dl:
            opt.zero_grad()
            logits = model(X)
            loss   = crit(logits, y)
            loss.backward(); opt.step()
            t_ok += (logits.argmax(1) == y).sum().item(); t_n += len(y)
        sched.step()

        model.eval()
        v_ok = v_n = 0
        with torch.no_grad():
            for X, y in val_dl:
                v_ok += (model(X).argmax(1) == y).sum().item(); v_n += len(y)
        v_acc = v_ok / v_n
        if v_acc > best_acc:
            best_acc  = v_acc
            best_state = {k: v.clone() for k, v in model.state_dict().items()}

        if ep % 20 == 0 or ep == 1:
            print(f"Ep {ep:3d}/{EPOCHS}  train={t_ok/t_n:.1%}  val={v_acc:.1%}  best={best_acc:.1%}")

    print(f"\nBest val accuracy: {best_acc:.1%}")
    model.load_state_dict(best_state)
    model.eval()

    # ── Confusion matrix ──────────────────────────────────────────────────────
    conf = np.zeros((len(NOTES), len(NOTES)), dtype=int)
    with torch.no_grad():
        for X, y in DataLoader(NoteDS(val_items), batch_size=64):
            preds = model(X).argmax(1)
            for t, p in zip(y.numpy(), preds.numpy()): conf[t, p] += 1

    print(f"\nConfusion matrix (rows=true, cols=predicted):")
    print("      " + "  ".join(f"{l:4s}" for l in LABELS))
    for i, row in enumerate(conf):
        print(f"  {LABELS[i]:4s}  " + "  ".join(f"{v:4d}" for v in row))
    print(f"\nPer-class accuracy:")
    for i, acc in enumerate(conf.diagonal() / conf.sum(axis=1)):
        print(f"  {LABELS[i]:4s}: {acc:.1%}")

    # ── Export weights + feature params as JSON (consumed by JS worker) ───────
    os.makedirs('public', exist_ok=True)

    def t2list(name): return model.state_dict()[name].numpy().tolist()

    out = {
        'labels':      LABELS,
        'sr':          SR,
        'n_fft':       N_FFT,
        'hop':         HOP,
        'n_mels':      N_MELS,
        'n_frames':    N_FRAMES,
        'onset_frames': 20,
        'filterbank':  FILTERBANK.tolist(),
        # MLP weights (3 linear layers + BN params)
        'w0': t2list('net.0.weight'), 'b0': t2list('net.0.bias'),
        'bn0_w': t2list('net.1.weight'), 'bn0_b': t2list('net.1.bias'),
        'bn0_mean': t2list('net.1.running_mean'), 'bn0_var': t2list('net.1.running_var'),
        'w1': t2list('net.4.weight'), 'b1': t2list('net.4.bias'),
        'bn1_w': t2list('net.5.weight'), 'bn1_b': t2list('net.5.bias'),
        'bn1_mean': t2list('net.5.running_mean'), 'bn1_var': t2list('net.5.running_var'),
        'w2': t2list('net.8.weight'), 'b2': t2list('net.8.bias'),
    }
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    kb = os.path.getsize(OUT) / 1024
    print(f"\nSaved → {OUT}  ({kb:.0f} KB)")


if __name__ == '__main__':
    main()
