import { pipeline, env } from '@huggingface/transformers'

const MODEL = 'onnx-community/whisper-tiny'

let transcriber = null

async function init(onProgress) {
  // Check WebGPU before downloading so we only fetch the right model files
  const useWebGPU = 'gpu' in navigator

  if (useWebGPU) {
    try {
      transcriber = await pipeline('automatic-speech-recognition', MODEL, {
        device: 'webgpu',
        // fp16 encoder + q4 decoder: fast on GPU, ~40 MB total
        dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
        progress_callback: onProgress,
      })
      return 'webgpu'
    } catch (err) {
      // GPU driver too old, insufficient VRAM, API not enabled — fall through
      console.warn('[whisper] WebGPU failed, falling back to WASM:', err.message)
    }
  }

  // WASM fallback — single-threaded to avoid SharedArrayBuffer requirement
  env.backends.onnx.wasm.numThreads = 1
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
        if (p.status === 'progress') {
          self.postMessage({ type: 'progress', pct: Math.round(p.progress ?? 0) })
        }
      })
      self.postMessage({ type: 'ready', device })
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message })
    }
  }

  if (e.data.type === 'transcribe') {
    if (!transcriber) { self.postMessage({ type: 'result', text: '' }); return }
    try {
      // Pass explicit sampling_rate so the pipeline can resample correctly
      const input = { array: e.data.audio, sampling_rate: e.data.samplingRate ?? 16000 }
      const result = await transcriber(input, {
        language: e.data.lang === 'fr' ? 'french' : 'english',
        task: 'transcribe',
      })
      self.postMessage({ type: 'result', text: result.text ?? '' })
    } catch (err) {
      // Always reply so the composable can unlock processingLocked
      self.postMessage({ type: 'result', text: '' })
    }
  }
})
