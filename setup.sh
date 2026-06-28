#!/usr/bin/env bash
# Regenerate the large files that are excluded from git.
# Run once after cloning, and again after adding new training samples.
set -e

# 1. ONNX-runtime WASM — copied from the npm package
echo "Copying WASM runtime files…"
cp node_modules/onnxruntime-web/dist/ort-wasm*.wasm public/
cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs  public/

# 2. Train the keyword-spotter and export ONNX + config
# Requires: torch, torchaudio, onnx, onnxscript  (pip install torch torchaudio onnx onnxscript)
# Training data must already be in training/split/<note>/*.wav
echo "Training model…"
python3 train_model.py

echo ""
echo "Done. Files written to public/:"
ls -lh public/kws_model.onnx public/kws_config.json public/ort-wasm*.wasm
