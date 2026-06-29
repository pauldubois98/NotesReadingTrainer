# Notes Reading Trainer

A web app to practise reading musical notes.
A note is displayed on a staff and you identify it by clicking a button or saying it aloud.
Tracks response time, errors, and session stats.

## Run locally

### Prerequisites
- **Node.js** ≥ 18
- **Python** ≥ 3.10 with `torch` and `torchaudio` (only needed to regenerate the voice model)

### 1. Install JS dependencies
```bash
npm install
```

### 2. Generate the voice recognition model
The trained model files (`public/kws_model.json`, `public/kws_config.json`) are excluded from git because they are large.
Generate them once:
```bash
pip install torch torchaudio
bash setup.sh
```
This runs `train_model.py`, which reads the pre-split audio samples in `training/split/` and writes the model to `public/`.
Training takes about 70 seconds on CPU.

> If you add new training recordings (batch `.wav` files in `training/`), run `python3 split_recordings.py` first to segment them, then re-run `bash setup.sh`.

### 3. Start the dev server
```bash
npm run dev
```
Go to [http://localhost:5173](http://localhost:5173)

## Other commands
```bash
npm run build      # Production build → dist/
npm run preview    # Preview the production build locally
npm run lint       # Lint with Biome
npm run format     # Auto-format with Biome
```
