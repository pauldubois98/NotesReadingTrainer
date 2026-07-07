import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/NotesReadingTrainer/',
  plugins: [vue()],
  worker: { format: 'es' },
  // SharedArrayBuffer required by the WASM ONNX runtime and TF.js
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  // Polyfill browser incompatibilities
  define: {
    global: 'window',
  },
  // Increase chunk size warning limit since TF.js is large
  build: {
    chunkSizeWarningLimit: 1000,
  },
})
