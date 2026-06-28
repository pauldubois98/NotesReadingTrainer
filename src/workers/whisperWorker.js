import { pipeline } from '@huggingface/transformers'

// whisper-small gives dramatically better accuracy for solfège note names
const MODEL = 'onnx-community/whisper-small'

let transcriber = null

async function init(onProgress) {
  const useWebGPU = 'gpu' in navigator

  if (useWebGPU) {
    try {
      transcriber = await pipeline('automatic-speech-recognition', MODEL, {
        device: 'webgpu',
        dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
        progress_callback: onProgress,
      })
      return 'webgpu'
    } catch (err) {
      console.warn('[whisper] WebGPU failed, falling back to WASM:', err.message)
    }
  }

  transcriber = await pipeline('automatic-speech-recognition', MODEL, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: onProgress,
  })
  return 'wasm'
}

self.addEventListener('message', async (e) => {
  if (e.data.type === 'init') {
    try {
      const device = await init((p) => {
        if (p.status === 'progress')
          self.postMessage({ type: 'progress', pct: Math.round(p.progress ?? 0) })
      })
      self.postMessage({ type: 'ready', device })
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message })
    }
  }

  if (e.data.type === 'transcribe') {
    if (!transcriber) { self.postMessage({ type: 'result', text: '' }); return }
    try {
      const input = { array: e.data.audio, sampling_rate: e.data.samplingRate ?? 16000 }
      // Run French and English in parallel:
      // FR handles most notes well (ré, sol, la, si, …)
      // EN handles edge cases FR gets wrong (e.g. "do" → "de" in FR)
      // Composable scans all words from both transcripts for a match.
      const [resFr, resEn] = await Promise.all([
        transcriber(input, { language: 'french',  task: 'transcribe' }),
        transcriber(input, { language: 'english', task: 'transcribe' }),
      ])
      const combined = (resFr.text ?? '') + ' ' + (resEn.text ?? '')
      self.postMessage({ type: 'result', text: combined })
    } catch (err) {
      self.postMessage({ type: 'result', text: '' })
    }
  }
})
