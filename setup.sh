#!/usr/bin/env bash
# Regenerate the large files that are excluded from git.
# Run once after cloning, and again after adding new training samples.
#
# Prerequisites:
#   npm install
#   pip install torch torchaudio  (or: pip install -r requirements-train.txt)
#
# Training data must be in training/split/<note>/*.wav (16 kHz mono)
set -e

echo "Training keyword-spotter model…"
python3 train_model.py

echo ""
echo "Done. Files written to public/:"
ls -lh public/kws_model.json public/kws_config.json
