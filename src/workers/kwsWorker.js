/**
 * Keyword-spotting worker — pure JS, no WASM / ORT.
 * Loads kws_model.json (~750 KB), then classifies in < 1 ms per utterance.
 */

let M = null   // model weights + feature params

// ── Mel spectrogram helpers ───────────────────────────────────────────────────

let windowFn   = null
let filterbank = null   // Float32Array, row-major (n_mels × bins)

function buildWindow(n) {
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)))
  return w
}

// Radix-2 in-place FFT
function fft(re, im) {
  const N = re.length
  let j = 0
  for (let i = 1; i < N; i++) {
    let bit = N >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { ;[re[i], re[j]] = [re[j], re[i]]; ;[im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len
    const wR = Math.cos(ang), wI = Math.sin(ang)
    for (let i = 0; i < N; i += len) {
      let cR = 1, cI = 0
      for (let k = 0; k < len >> 1; k++) {
        const uR = re[i+k], uI = im[i+k]
        const h  = i+k+(len>>1)
        const vR = re[h]*cR - im[h]*cI, vI = re[h]*cI + im[h]*cR
        re[i+k] = uR+vR; im[i+k] = uI+vI; re[h] = uR-vR; im[h] = uI-vI
        const nr = cR*wR - cI*wI; cI = cR*wI + cI*wR; cR = nr
      }
    }
  }
}

function melSpec(samples) {
  const { n_fft, hop, n_mels, n_frames } = M
  const bins = n_fft / 2 + 1
  const need = (n_frames - 1) * hop + n_fft
  let s = samples.length < need
    ? (()=>{ const p = new Float32Array(need); p.set(samples); return p })()
    : samples.subarray(0, need)

  const reArr = new Float32Array(n_fft)
  const imArr = new Float32Array(n_fft)
  const S     = new Float32Array(n_mels * n_frames)

  for (let t = 0; t < n_frames; t++) {
    reArr.fill(0); imArr.fill(0)
    for (let k = 0; k < n_fft; k++) reArr[k] = s[t * hop + k] * windowFn[k]
    fft(reArr, imArr)
    for (let m = 0; m < n_mels; m++) {
      let e = 0, row = m * bins
      for (let b = 0; b < bins; b++) e += filterbank[row + b] * (reArr[b]*reArr[b] + imArr[b]*imArr[b])
      S[m * n_frames + t] = Math.log(e + 1e-8)
    }
  }
  return S   // (n_mels × n_frames), row-major
}

function trimSilence(samples) {
  // Trim leading AND trailing silence so that feature extraction operates only
  // on the speech segment — matching how training clips were already segmented.
  // Room noise (non-zero "silence") would otherwise shift g_mean and abs_delta
  // away from the values the model learned during training.
  const frameLen = M.hop
  const nFrames  = Math.floor(samples.length / frameLen)
  const rms      = new Float32Array(nFrames)
  let peakRms    = 0

  for (let t = 0; t < nFrames; t++) {
    let s = 0
    for (let i = 0; i < frameLen; i++) { const v = samples[t * frameLen + i]; s += v * v }
    rms[t] = Math.sqrt(s / frameLen)
    if (rms[t] > peakRms) peakRms = rms[t]
  }

  const threshold = peakRms * 0.10
  let onset  = 0
  let offset = nFrames - 1
  for (let t = 0;           t < nFrames; t++)  { if (rms[t] >= threshold) { onset  = t; break } }
  for (let t = nFrames - 1; t >= 0;      t--)  { if (rms[t] >= threshold) { offset = t; break } }

  const start = Math.max(0,              (onset  - 2) * frameLen)
  const end   = Math.min(samples.length, (offset + 3) * frameLen)
  return samples.subarray(start, end)
}

function extractFeatures(samples) {
  const { n_mels, n_frames, onset_frames } = M
  const aligned = trimSilence(samples)
  const S = melSpec(aligned)   // (n_mels × n_frames)

  const gMean   = new Float32Array(n_mels)
  const gStd    = new Float32Array(n_mels)
  const oMean   = new Float32Array(n_mels)
  const absDelta = new Float32Array(n_mels)

  for (let m = 0; m < n_mels; m++) {
    let sum = 0, sum2 = 0, osum = 0, dsum = 0
    for (let t = 0; t < n_frames; t++) { const v = S[m * n_frames + t]; sum += v; sum2 += v*v }
    for (let t = 0; t < onset_frames; t++) osum += S[m * n_frames + t]
    for (let t = 0; t < n_frames - 1; t++) dsum += Math.abs(S[m * n_frames + t + 1] - S[m * n_frames + t])
    const mean = sum / n_frames
    gMean[m]    = mean
    gStd[m]     = Math.sqrt(sum2/n_frames - mean*mean)
    oMean[m]    = osum / onset_frames
    absDelta[m] = dsum / (n_frames - 1)
  }

  // Concatenate [mean | std | onset | absDelta] and normalise
  const feat = new Float32Array(n_mels * 4)
  feat.set(gMean, 0); feat.set(gStd, n_mels); feat.set(oMean, n_mels * 2); feat.set(absDelta, n_mels * 3)
  let fSum = 0, fSum2 = 0
  for (let i = 0; i < feat.length; i++) { fSum += feat[i]; fSum2 += feat[i]*feat[i] }
  const fMu  = fSum / feat.length
  const fSig = Math.sqrt(fSum2/feat.length - fMu*fMu) || 1
  for (let i = 0; i < feat.length; i++) feat[i] = (feat[i] - fMu) / fSig
  return feat
}

// ── MLP forward pass ──────────────────────────────────────────────────────────

function linear(x, W, b) {
  const nOut = W.length, nIn = x.length
  const out  = new Float32Array(nOut)
  for (let i = 0; i < nOut; i++) {
    let s = b[i], row = W[i]
    for (let j = 0; j < nIn; j++) s += row[j] * x[j]
    out[i] = s
  }
  return out
}

function batchNorm(x, w, b, mean, variance) {
  const out = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++)
    out[i] = w[i] * (x[i] - mean[i]) / Math.sqrt(variance[i] + 1e-5) + b[i]
  return out
}

function relu(x) { for (let i = 0; i < x.length; i++) if (x[i] < 0) x[i] = 0; return x }

function mlpForward(feat) {
  let x = feat
  x = relu(batchNorm(linear(x, M.w0, M.b0), M.bn0_w, M.bn0_b, M.bn0_mean, M.bn0_var))
  x = relu(batchNorm(linear(x, M.w1, M.b1), M.bn1_w, M.bn1_b, M.bn1_mean, M.bn1_var))
  x = linear(x, M.w2, M.b2)
  return x   // logits
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const cfg = await fetch(`${self.location.origin}/kws_model.json`).then(r => r.json())
  M          = cfg
  windowFn   = buildWindow(cfg.n_fft)
  filterbank = new Float32Array(cfg.filterbank.flat())
  // Pre-convert weight arrays to Float32Array for speed
  M.w0 = cfg.w0.map(row => new Float32Array(row))
  M.b0 = new Float32Array(cfg.b0)
  M.bn0_w = new Float32Array(cfg.bn0_w); M.bn0_b = new Float32Array(cfg.bn0_b)
  M.bn0_mean = new Float32Array(cfg.bn0_mean); M.bn0_var = new Float32Array(cfg.bn0_var)
  M.w1 = cfg.w1.map(row => new Float32Array(row))
  M.b1 = new Float32Array(cfg.b1)
  M.bn1_w = new Float32Array(cfg.bn1_w); M.bn1_b = new Float32Array(cfg.bn1_b)
  M.bn1_mean = new Float32Array(cfg.bn1_mean); M.bn1_var = new Float32Array(cfg.bn1_var)
  M.w2 = cfg.w2.map(row => new Float32Array(row))
  M.b2 = new Float32Array(cfg.b2)

  self.postMessage({ type: 'ready' })
}

// ── Inference ─────────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.75

function transcribe(audio) {
  const t0     = performance.now()
  const feat   = extractFeatures(audio)
  const logits = mlpForward(feat)

  const maxL = Math.max(...logits)
  const exps = logits.map(v => Math.exp(v - maxL))
  const sumE = exps.reduce((a, b) => a + b, 0)
  const probs = exps.map(v => v / sumE)

  const noteIdx = probs.indexOf(Math.max(...probs))
  const conf    = probs[noteIdx]
  const ms      = (performance.now() - t0).toFixed(1)

  if (conf < CONFIDENCE_THRESHOLD) {
    self.postMessage({ type: 'result', note: null, conf })
    return
  }
  self.postMessage({ type: 'result', note: noteIdx, label: M.labels[noteIdx], conf, ms })
}

// ── Message handler ───────────────────────────────────────────────────────────

self.addEventListener('message', (e) => {
  if (e.data.type === 'init')       init().catch(err => self.postMessage({ type: 'error', message: err.message }))
  if (e.data.type === 'transcribe') transcribe(e.data.audio)
})
