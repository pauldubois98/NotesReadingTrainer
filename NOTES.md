# How this app works

## Voice recognition
The app ships a keyword-spotter (KWS) that recognises the 7 solfège names (Do, Ré, Mi, Fa, Sol, La, Si) spoken by the user.
It runs entirely in the browser via a Web Worker; no server needed.

### How it works
- **Features:** 256-D hand-crafted mel spectrogram features (global mean + std + onset mean + abs delta per mel band), computed in JS using a custom FFT
- **Model:** 3-layer MLP (256 → 128 → 64 → 7) trained in PyTorch, exported as a JSON file
- **VAD:** 1-second sliding ring buffer, inference every ~200 ms when energy exceeds the adaptive noise floor
- **Smoothing:** requires 2 consecutive agreeing windows before accepting a note; 700 ms debounce

### Train a personal model
Open the setup screen and click **"🎤 Train my voice"**.
Record 5 samples per note by holding the record button and speaking.
After all 7 notes are done, click **"Train model"**.
A lightweight softmax classifier is fitted to your voice in under a second, entirely in the browser.
The personal model is saved to `localStorage` and used automatically on future visits.
