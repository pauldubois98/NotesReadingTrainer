#!/usr/bin/env python3
"""
Split a long recording of repeated note names into individual WAV files.

Usage:
    python3 split_recordings.py <input.wav> <note_name> [--threshold DB] [--min-ms MS] [--pad-ms MS]

Examples:
    python3 split_recordings.py do_batch.wav do
    python3 split_recordings.py re_batch.wav re --threshold -38
    python3 split_recordings.py all_notes.wav do --min-ms 150

The script:
1. Converts input to 16-bit mono 16 kHz WAV via ffmpeg (same format Whisper uses)
2. Auto-detects a silence threshold if none given (10 dB above noise floor)
3. Splits on silent gaps ≥ min_silence_ms
4. Saves each segment to training/<note>/<note>_001.wav, _002.wav, …
5. Prints a summary table so you can spot bad splits
"""

import argparse
import math
import os
import struct
import subprocess
import sys
import tempfile
import wave

import numpy as np

TARGET_SR = 16000   # Whisper's expected sample rate


# ── WAV I/O ──────────────────────────────────────────────────────────────────

def convert_to_mono16(input_path: str) -> np.ndarray:
    """Use ffmpeg to convert any audio to 16 kHz mono float32."""
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        tmp_path = tmp.name
    try:
        subprocess.run(
            ['ffmpeg', '-y', '-i', input_path,
             '-ac', '1', '-ar', str(TARGET_SR), '-f', 'wav', tmp_path],
            check=True, capture_output=True,
        )
        with wave.open(tmp_path) as wf:
            assert wf.getnchannels() == 1
            raw = wf.readframes(wf.getnframes())
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    finally:
        os.unlink(tmp_path)
    return samples


def save_wav(path: str, samples: np.ndarray, sr: int = TARGET_SR):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(path, 'w') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())


# ── Silence detection ─────────────────────────────────────────────────────────

def rms_db(samples: np.ndarray) -> float:
    rms = math.sqrt(max(np.mean(samples ** 2), 1e-12))
    return 20 * math.log10(rms)


def frame_energies(samples: np.ndarray, frame_ms: int = 20, sr: int = TARGET_SR) -> np.ndarray:
    """Return per-frame RMS energy in dBFS."""
    frame_len = int(sr * frame_ms / 1000)
    n_frames = len(samples) // frame_len
    frames = samples[:n_frames * frame_len].reshape(n_frames, frame_len)
    rms = np.sqrt(np.mean(frames ** 2, axis=1).clip(1e-12))
    return 20 * np.log10(rms)


def auto_threshold(energies: np.ndarray) -> float:
    """Estimate noise floor and set threshold 10 dB above it."""
    noise_floor = np.percentile(energies, 10)   # quietest 10 % of frames
    threshold = noise_floor + 10
    print(f"  Noise floor ≈ {noise_floor:.1f} dBFS  →  auto threshold = {threshold:.1f} dBFS")
    return threshold


def find_speech_segments(
    energies: np.ndarray,
    threshold_db: float,
    frame_ms: int,
    min_speech_ms: int,
    min_silence_ms: int,
) -> list[tuple[int, int]]:
    """
    Return list of (start_frame, end_frame) pairs for each speech segment.
    """
    is_speech = energies > threshold_db
    min_speech_frames  = max(1, min_speech_ms  // frame_ms)
    min_silence_frames = max(1, min_silence_ms // frame_ms)

    # Smooth: fill short silence gaps inside speech (prevents splitting on glottal stops)
    filled = is_speech.copy()
    i = 0
    while i < len(filled):
        if not filled[i]:
            j = i
            while j < len(filled) and not filled[j]:
                j += 1
            gap = j - i
            if gap < min_silence_frames:
                filled[i:j] = True   # bridge short silence
            i = j
        else:
            i += 1

    # Extract segments
    segments = []
    in_speech = False
    start = 0
    for f, active in enumerate(filled):
        if active and not in_speech:
            in_speech = True
            start = f
        elif not active and in_speech:
            in_speech = False
            if f - start >= min_speech_frames:
                segments.append((start, f))
    if in_speech and len(filled) - start >= min_speech_frames:
        segments.append((start, len(filled)))

    return segments


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('input', help='Long recording WAV/MP3/M4A/…')
    parser.add_argument('note', help='Note name label (do, re, mi, fa, sol, la, si)')
    parser.add_argument('--threshold', type=float, default=None,
                        help='Silence threshold in dBFS (e.g. -40). Auto-detected if omitted.')
    parser.add_argument('--min-ms',     type=int,   default=120,
                        help='Minimum speech segment length in ms (default 120)')
    parser.add_argument('--max-ms',     type=int,   default=2500,
                        help='Maximum segment length in ms — longer ones are flagged (default 2500)')
    parser.add_argument('--min-silence', type=int,  default=250,
                        help='Minimum silence gap between utterances in ms (default 250)')
    parser.add_argument('--pad-ms',     type=int,   default=40,
                        help='Silence padding to keep at each end of a segment in ms (default 40)')
    parser.add_argument('--out-dir',    default='training',
                        help='Output directory (default: ./training)')
    parser.add_argument('--frame-ms',   type=int,   default=20,
                        help='Analysis frame size in ms (default 20)')
    args = parser.parse_args()

    print(f"\n{'='*60}")
    print(f"  Input : {args.input}")
    print(f"  Note  : {args.note}")
    print(f"{'='*60}\n")

    # 1. Load
    print("Loading audio…")
    samples = convert_to_mono16(args.input)
    total_s = len(samples) / TARGET_SR
    print(f"  Duration: {total_s:.1f} s  ({len(samples):,} samples at {TARGET_SR} Hz)\n")

    # 2. Energy analysis
    frame_ms = args.frame_ms
    energies = frame_energies(samples, frame_ms=frame_ms)

    if args.threshold is None:
        threshold_db = auto_threshold(energies)
    else:
        threshold_db = args.threshold
        print(f"  Using threshold = {threshold_db:.1f} dBFS")

    # 3. Find segments
    pad_frames = max(1, args.pad_ms // frame_ms)
    segments = find_speech_segments(
        energies,
        threshold_db=threshold_db,
        frame_ms=frame_ms,
        min_speech_ms=args.min_ms,
        min_silence_ms=args.min_silence,
    )

    print(f"\nFound {len(segments)} segments.\n")
    if not segments:
        print("No segments found. Try lowering --threshold (e.g. --threshold -50)")
        sys.exit(1)

    # 4. Save + report
    out_dir = os.path.join(args.out_dir, args.note)
    samples_per_frame = int(TARGET_SR * frame_ms / 1000)
    pad_samples = pad_frames * samples_per_frame

    # Auto-detect highest existing index so we never overwrite earlier splits
    os.makedirs(out_dir, exist_ok=True)
    existing = [f for f in os.listdir(out_dir) if f.endswith('.wav')]
    start_index = 1
    if existing:
        indices = []
        for fn in existing:
            try:
                indices.append(int(fn.rsplit('_', 1)[-1].replace('.wav', '')))
            except ValueError:
                pass
        if indices:
            start_index = max(indices) + 1
    if start_index > 1:
        print(f"  Continuing from index {start_index} (found {start_index - 1} existing files)\n")

    too_short, too_long, saved = [], [], []
    print(f"{'#':>4}  {'Start':>7}  {'End':>7}  {'Duration':>9}  {'Peak dBFS':>10}  Status")
    print(f"{'-'*4}  {'-'*7}  {'-'*7}  {'-'*9}  {'-'*10}  ------")

    for i, (sf, ef) in enumerate(segments, 1):
        ss = max(0, sf * samples_per_frame - pad_samples)
        se = min(len(samples), ef * samples_per_frame + pad_samples)
        seg = samples[ss:se]
        dur_ms = int(len(seg) / TARGET_SR * 1000)
        peak_db = 20 * math.log10(max(np.max(np.abs(seg)), 1e-9))

        start_s = ss / TARGET_SR
        end_s   = se / TARGET_SR

        if dur_ms < args.min_ms:
            status = '⚠ too short'
            too_short.append(i)
        elif dur_ms > args.max_ms:
            status = '⚠ too long'
            too_long.append(i)
        else:
            status = '✅'
            out_idx = start_index + len(saved)
            fname = os.path.join(out_dir, f"{args.note}_{out_idx:03d}.wav")
            save_wav(fname, seg)
            saved.append(out_idx)

        print(f"{i:>4}  {start_s:>6.2f}s  {end_s:>6.2f}s  {dur_ms:>7} ms  {peak_db:>9.1f}  {status}")

    print(f"\n{'='*60}")
    print(f"  Saved  : {len(saved)} segments → {out_dir}/")
    if too_short:
        print(f"  Too short (<{args.min_ms} ms): segments {too_short} — likely noise pops")
    if too_long:
        print(f"  Too long  (>{args.max_ms} ms): segments {too_long} — may contain multiple words")
    if too_long:
        print(f"\n  Tip: if segments are merging, try --min-silence {args.min_silence + 100}")
    if too_short:
        print(f"  Tip: if pops are detected, try --threshold {threshold_db + 5:.0f}")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
