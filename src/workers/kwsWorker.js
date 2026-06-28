/**
 * Keyword spotting worker — replaces Whisper for note recognition.
 * Uses a tiny CNN (~150K params) trained on mel spectrograms of the 7 note names.
 * Inference latency: <5 ms vs ~2 s for Whisper.
 */
import * as ort from 'onnxruntime-web'

let session = null
let config  = null   // { labels, sr, n_fft, hop, n_mels, n_frames, filterbank }

// ── Mel spectrogram (mirrors train_model.py exactly) ─────────────────────────

let window_fn  = null   // Hanning window, length n_fft
let filterbank = null   // Float32Array[n_mels * (n_fft/2+1)], row-major

function buildWindow(n) {
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++)
    w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)))
  return w
}

// Radix-2 Cooley-Tukey FFT — in-place, power-of-2 size
function fft(re, im) {
  const N = re.length
  // Bit-reversal
  let j = 0
  for (let i = 1; i < N; i++) {
    let bit = N >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  // Butterfly
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len
    const wR = Math.cos(ang), wI = Math.sin(ang)
    for (let i = 0; i < N; i += len) {
      let curR = 1, curI = 0
      for (let k = 0; k < len >> 1; k++) {
        const uR = re[i+k], uI = im[i+k]
        const vR = re[i+k+(len>>1)]*curR - im[i+k+(len>>1)]*curI
        const vI = re[i+k+(len>>1)]*curI + im[i+k+(len>>1)]*curR
        re[i+k]          = uR+vR;  im[i+k]          = uI+vI
        re[i+k+(len>>1)] = uR-vR;  im[i+k+(len>>1)] = uI-vI
        const nr = curR*wR - curI*wI; curI = curR*wI + curI*wR; curR = nr
      }
    }
  }
}

function melSpectrogram(samples) {
  const { n_fft, hop, n_mels, n_frames } = config
  const bins = n_fft / 2 + 1

  // Pad / truncate to exact length needed
  const need = (n_frames - 1) * hop + n_fft
  let s = samples
  if (s.length < need) {
    const padded = new Float32Array(need)
    padded.set(s)
    s = padded
  } else if (s.length > need) {
    s = s.subarray(0, need)
  }

  const spec   = new Float32Array(n_mels * n_frames)
  const reArr  = new Float32Array(n_fft)
  const imArr  = new Float32Array(n_fft)

  for (let t = 0; t < n_frames; t++) {
    // Windowed frame
    reArr.fill(0); imArr.fill(0)
    for (let k = 0; k < n_fft; k++)
      reArr[k] = s[t * hop + k] * window_fn[k]

    fft(reArr, imArr)

    // Power spectrum → mel → log
    for (let m = 0; m < n_mels; m++) {
      let energy = 0
      const row = m * bins
      for (let b = 0; b < bins; b++)
        energy += filterbank[row + b] * (reArr[b]*reArr[b] + imArr[b]*imArr[b])
      spec[m * n_frames + t] = Math.log(energy + 1e-8)
    }
  }

  // Per-sample mean-std normalisation (mirrors Python)
  let sum = 0, sum2 = 0, len = spec.length
  for (let i = 0; i < len; i++) { sum += spec[i]; sum2 += spec[i]*spec[i] }
  const mean = sum / len
  const std  = Math.sqrt(sum2/len - mean*mean) || 1
  for (let i = 0; i < len; i++) spec[i] = (spec[i] - mean) / std

  return spec
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const base = self.location.origin

  // Load config (filterbank + params)
  const cfg = await fetch(`${base}/kws_config.json`).then(r => r.json())
  config = cfg

  window_fn  = buildWindow(cfg.n_fft)
  filterbank = new Float32Array(cfg.filterbank.flat())

  // Load ONNX model
  ort.env.wasm.wasmPaths = `${base}/`
  session = await ort.InferenceSession.create(`${base}/kws_model.onnx`, {
    executionProviders: ['wasm'],
  })

  self.postMessage({ type: 'ready' })
}

// ── Inference ─────────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.60

async function transcribe(audio) {
  const { n_mels, n_frames } = config

  const spec    = melSpectrogram(audio)
  // Model input: (1, 1, n_mels, n_frames) — batch × channels × mels × time
  const tensor  = new ort.Tensor('float32', spec, [1, 1, n_mels, n_frames])
  const results = await session.run({ mel: tensor })
  const logits  = results.logits.data  // Float32Array of length 7

  // Softmax
  const maxL  = Math.max(...logits)
  const exps  = logits.map(v => Math.exp(v - maxL))
  const sumE  = exps.reduce((a, b) => a + b, 0)
  const probs = exps.map(v => v / sumE)

  const noteIdx = probs.indexOf(Math.max(...probs))
  const conf    = probs[noteIdx]

  if (conf < CONFIDENCE_THRESHOLD) {
    self.postMessage({ type: 'result', note: null, conf })
    return
  }
  self.postMessage({ type: 'result', note: noteIdx, label: config.labels[noteIdx], conf })
}

// ── Message handler ───────────────────────────────────────────────────────────

self.addEventListener('message', async (e) => {
  if (e.data.type === 'init')       await init().catch(err => self.postMessage({ type: 'error', message: err.message }))
  if (e.data.type === 'transcribe') await transcribe(e.data.audio).catch(() => self.postMessage({ type: 'result', note: null }))
})
