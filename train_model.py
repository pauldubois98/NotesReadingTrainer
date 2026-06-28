#!/usr/bin/env python3
"""
Train a keyword spotter for 7 solfège notes (do ré mi fa sol la si).

Usage:
    python3 train_model.py

Outputs:
    public/kws_model.onnx   — ONNX model, input (1,1,N_MELS,N_FRAMES)
    public/kws_config.json  — mel filterbank + parameters for JS worker
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

NOTES     = ['do', 're', 'mi', 'fa', 'sol', 'la', 'si']  # dir names
LABELS    = ['do', 'ré', 'mi', 'fa', 'sol', 'la', 'si']  # canonical in app
SR        = 16000
N_FFT     = 512
HOP       = 160     # 10 ms at 16 kHz
N_MELS    = 64
N_FRAMES  = 100     # 1 second of audio

SPLIT_DIR  = 'training/split'
OUT_MODEL  = 'public/kws_model.onnx'
OUT_CONFIG = 'public/kws_config.json'

BATCH     = 32
EPOCHS    = 80
LR        = 1e-3
VAL_FRAC  = 0.15
SEED      = 42

# ── Mel filterbank ────────────────────────────────────────────────────────────

def _hz_to_mel(f):
    return 2595.0 * np.log10(1.0 + f / 700.0)

def _mel_to_hz(m):
    return 700.0 * (10.0 ** (m / 2595.0) - 1.0)

def build_filterbank(sr=SR, n_fft=N_FFT, n_mels=N_MELS, fmin=80, fmax=7600):
    mel_lo = _hz_to_mel(fmin)
    mel_hi = _hz_to_mel(fmax)
    mels   = np.linspace(mel_lo, mel_hi, n_mels + 2)
    bins   = np.floor((n_fft + 1) * _mel_to_hz(mels) / sr).astype(int)
    fb     = np.zeros((n_mels, n_fft // 2 + 1), dtype=np.float32)
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
        assert wf.getnchannels() == 1, path
        assert wf.getframerate() == SR, path
        raw = wf.readframes(wf.getnframes())
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def mel_spec(samples, n_frames=N_FRAMES):
    """Returns (N_MELS, n_frames) log-mel spectrogram, normalized per sample."""
    need = (n_frames - 1) * HOP + N_FFT
    if len(samples) < need:
        samples = np.pad(samples, (0, need - len(samples)))
    else:
        samples = samples[:need]

    S = np.zeros((N_MELS, n_frames), dtype=np.float32)
    for t in range(n_frames):
        frame  = samples[t * HOP: t * HOP + N_FFT] * WINDOW
        power  = np.abs(np.fft.rfft(frame, n=N_FFT)) ** 2
        S[:, t] = np.log(FILTERBANK @ power + 1e-8)

    mu, sigma = S.mean(), S.std()
    return (S - mu) / (sigma + 1e-6)


# ── Augmentation ──────────────────────────────────────────────────────────────

def augment(samples):
    # Random gain
    samples = samples * random.uniform(0.5, 1.5)
    # Random time shift ±100 ms
    shift = random.randint(-1600, 1600)
    if shift > 0:
        samples = np.concatenate([np.zeros(shift, dtype=np.float32), samples])
    else:
        samples = samples[-shift:] if shift < 0 else samples
    # Additive Gaussian noise
    samples += np.random.randn(len(samples)).astype(np.float32) * random.uniform(0, 0.008)
    return samples


# ── Dataset ───────────────────────────────────────────────────────────────────

class NoteDataset(Dataset):
    def __init__(self, items, do_aug=False):
        self.items  = items
        self.do_aug = do_aug

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        path, label = self.items[i]
        s = load_wav(path)
        if self.do_aug:
            s = augment(s)
        spec = mel_spec(s)
        return torch.tensor(spec).unsqueeze(0), label  # (1, N_MELS, N_FRAMES)


# ── Model ─────────────────────────────────────────────────────────────────────

class KWS(nn.Module):
    def __init__(self, n_classes=7):
        super().__init__()
        self.enc = nn.Sequential(
            # Block 1
            nn.Conv2d(1,  32, 3, padding=1), nn.BatchNorm2d(32),  nn.ReLU(),
            nn.Conv2d(32, 32, 3, padding=1), nn.BatchNorm2d(32),  nn.ReLU(),
            nn.MaxPool2d(2),                                        # → 32×32×50
            nn.Dropout2d(0.15),
            # Block 2
            nn.Conv2d(32, 64, 3, padding=1), nn.BatchNorm2d(64),  nn.ReLU(),
            nn.Conv2d(64, 64, 3, padding=1), nn.BatchNorm2d(64),  nn.ReLU(),
            nn.MaxPool2d(2),                                        # → 64×16×25
            nn.Dropout2d(0.15),
            # Block 3
            nn.Conv2d(64, 128, 3, padding=1), nn.BatchNorm2d(128), nn.ReLU(),
        )
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.head = nn.Sequential(
            nn.Dropout(0.4),
            nn.Linear(128, 64), nn.ReLU(),
            nn.Linear(64, n_classes),
        )

    def forward(self, x):
        return self.head(self.pool(self.enc(x)).flatten(1))


# ── Train ─────────────────────────────────────────────────────────────────────

def main():
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)

    # Gather samples
    all_items = []
    print("\nSamples per class:")
    for idx, note in enumerate(NOTES):
        d    = os.path.join(SPLIT_DIR, note)
        wavs = sorted(f for f in os.listdir(d) if f.endswith('.wav'))
        for w in wavs:
            all_items.append((os.path.join(d, w), idx))
        print(f"  {LABELS[idx]:4s}: {len(wavs)}")

    print(f"\nTotal: {len(all_items)}  (7 classes)")

    random.shuffle(all_items)
    n_val = max(7, int(len(all_items) * VAL_FRAC))
    val_items   = all_items[:n_val]
    train_items = all_items[n_val:]
    print(f"Train: {len(train_items)}  Val: {len(val_items)}\n")

    train_dl = DataLoader(NoteDataset(train_items, do_aug=True),
                          batch_size=BATCH, shuffle=True, num_workers=4)
    val_dl   = DataLoader(NoteDataset(val_items,   do_aug=False),
                          batch_size=BATCH, shuffle=False, num_workers=2)

    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f"Device: {device}")

    model = KWS(n_classes=len(NOTES)).to(device)
    print(f"Parameters: {sum(p.numel() for p in model.parameters()):,}\n")

    opt   = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=EPOCHS)
    crit  = nn.CrossEntropyLoss()

    best_acc, best_state = 0.0, None

    for ep in range(1, EPOCHS + 1):
        model.train()
        t_loss, t_ok, t_n = 0.0, 0, 0
        for X, y in train_dl:
            X, y = X.to(device), y.to(device)
            opt.zero_grad()
            logits = model(X)
            loss   = crit(logits, y)
            loss.backward()
            opt.step()
            t_loss += loss.item() * len(y); t_ok += (logits.argmax(1) == y).sum().item(); t_n += len(y)
        sched.step()

        model.eval()
        v_ok, v_n = 0, 0
        with torch.no_grad():
            for X, y in val_dl:
                X, y = X.to(device), y.to(device)
                v_ok += (model(X).argmax(1) == y).sum().item(); v_n += len(y)

        v_acc = v_ok / v_n
        if v_acc > best_acc:
            best_acc  = v_acc
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}

        if ep % 10 == 0 or ep == 1:
            print(f"Ep {ep:3d}/{EPOCHS}  loss={t_loss/t_n:.4f}  "
                  f"train={t_ok/t_n:.1%}  val={v_acc:.1%}  best={best_acc:.1%}")

    print(f"\nBest val accuracy: {best_acc:.1%}")

    # ── Export ────────────────────────────────────────────────────────────────
    model.load_state_dict(best_state)
    model.eval().cpu()

    os.makedirs('public', exist_ok=True)

    dummy = torch.zeros(1, 1, N_MELS, N_FRAMES)
    torch.onnx.export(
        model, dummy, OUT_MODEL,
        input_names=['mel'], output_names=['logits'],
        opset_version=17,
    )
    print(f"Saved → {OUT_MODEL}")

    config = {
        'labels':     LABELS,
        'sr':         SR,
        'n_fft':      N_FFT,
        'hop':        HOP,
        'n_mels':     N_MELS,
        'n_frames':   N_FRAMES,
        'filterbank': FILTERBANK.tolist(),
    }
    with open(OUT_CONFIG, 'w') as f:
        json.dump(config, f, separators=(',', ':'))
    fb_kb = len(json.dumps(config['filterbank'])) / 1024
    print(f"Saved → {OUT_CONFIG}  (filterbank: {N_MELS}×{N_FFT//2+1}, {fb_kb:.0f} KB)")

    # ── Confusion matrix on val set ───────────────────────────────────────────
    model.eval()
    conf = np.zeros((len(NOTES), len(NOTES)), dtype=int)
    ds   = NoteDataset(val_items, do_aug=False)
    with torch.no_grad():
        for X, y in DataLoader(ds, batch_size=32):
            preds = model(X).argmax(1)
            for true, pred in zip(y.numpy(), preds.numpy()):
                conf[true, pred] += 1

    print(f"\nConfusion matrix (rows=true, cols=predicted):")
    print(f"      " + "  ".join(f"{LABELS[i]:4s}" for i in range(len(LABELS))))
    for i, row in enumerate(conf):
        print(f"  {LABELS[i]:4s}  " + "  ".join(f"{v:4d}" for v in row))

    per_class = conf.diagonal() / conf.sum(axis=1)
    print(f"\nPer-class accuracy:")
    for i, acc in enumerate(per_class):
        print(f"  {LABELS[i]:4s}: {acc:.1%}")


if __name__ == '__main__':
    main()
