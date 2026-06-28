import { pipeline } from '@huggingface/transformers'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))

// WAV decoder — reads mono/stereo 16-bit PCM or 32-bit float WAV
// Returns Float32Array at the file's native sample rate
function decodeWav(nodeBuf) {
  // Node Buffer → proper ArrayBuffer slice (important: Buffer may share underlying AB with an offset)
  const ab   = nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength)
  const view = new DataView(ab)

  const audioFormat = view.getUint16(20, true)  // 1=PCM, 3=IEEE float
  const channels    = view.getUint16(22, true)
  const sampleRate  = view.getUint32(24, true)
  const bitDepth    = view.getUint16(34, true)

  // Locate 'data' chunk — it may not start at byte 44 if there are extra chunks
  let pos = 12
  let dataOffset = -1, dataLen = 0
  while (pos + 8 <= ab.byteLength) {
    const tag  = String.fromCharCode(view.getUint8(pos), view.getUint8(pos+1), view.getUint8(pos+2), view.getUint8(pos+3))
    const size = view.getUint32(pos + 4, true)
    if (tag === 'data') { dataOffset = pos + 8; dataLen = size; break }
    pos += 8 + size
  }
  if (dataOffset < 0) throw new Error('No data chunk found in WAV')

  const bytesPerSample = bitDepth / 8
  const frameSize = bytesPerSample * channels
  const numFrames = Math.floor(dataLen / frameSize)
  const out = new Float32Array(numFrames)

  for (let i = 0; i < numFrames; i++) {
    const off = dataOffset + i * frameSize
    let s = 0
    if (bitDepth === 16 && audioFormat === 1) {
      s = view.getInt16(off, true) / 32768
    } else if (bitDepth === 32 && audioFormat === 3) {
      s = view.getFloat32(off, true)
    } else if (bitDepth === 32 && audioFormat === 1) {
      s = view.getInt32(off, true) / 2147483648
    } else if (bitDepth === 24 && audioFormat === 1) {
      const b0 = view.getUint8(off), b1 = view.getUint8(off+1), b2 = view.getInt8(off+2)
      s = ((b2 << 16) | (b1 << 8) | b0) / 8388608
    }
    // Downmix to mono by taking left channel only
    out[i] = s
  }
  return { samples: out, sampleRate }
}

// Linear-interpolation resample
function resample(src, fromSR, toSR) {
  if (fromSR === toSR) return src
  const ratio  = fromSR / toSR
  const outLen = Math.floor(src.length / ratio)
  const dst    = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const p  = i * ratio
    const lo = Math.floor(p), hi = Math.min(lo + 1, src.length - 1)
    dst[i] = src[lo] + (src[hi] - src[lo]) * (p - lo)
  }
  return dst
}

const NOTES = ['do', 'do2', 're', 're2', 'mi', 'mi2', 'fa', 'fa2', 'sol', 'sol2', 'la', 'la2', 'si', 'si2']
const WHISPER_SR = 16000

console.log('Loading Whisper model (onnx-community/whisper-tiny, cpu/q8)…\n')

const transcriber = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-small', {
  device: 'cpu',
  dtype: 'q8',
  progress_callback: (p) => {
    if (p.status === 'progress') process.stdout.write(`\r  ${p.file} ${Math.round(p.progress ?? 0)}%   `)
  },
})
console.log('\nModel ready.\n')

// Same normalization that will go into useVoiceInput.js
function normalizeWord(w) {
  return w.replace(/[^a-zàâéèêëîïôùûüç]/g, '').replace(/(.)\1+/g, '$1')
}

// Expanded aliases including what whisper-base actually outputs
const ALIASES_EXPANDED = {
  do: 'do', doe: 'do', dou: 'do', doux: 'do',
  ré: 'ré', re: 'ré', ray: 'ré', reh: 'ré', oui: 'ré',
  mi: 'mi', me: 'mi',
  fa: 'fa', fah: 'fa', fuh: 'fa', far: 'fa',
  sol: 'sol', soul: 'sol', sole: 'sol', so: 'sol', sous: 'sol',
  la: 'la', là: 'la', lah: 'la',
  si: 'si', see: 'si', sea: 'si', cest: 'si', ces: 'si',
}

function extractNoteNew(transcript) {
  for (const raw of transcript.trim().toLowerCase().split(/\s+/)) {
    const w = normalizeWord(raw)
    const hit = ALIASES_EXPANDED[w]
    if (hit) return hit
  }
  return null
}

const MODELS_TESTED = ['onnx-community/whisper-tiny', 'onnx-community/whisper-small']
// We're running tiny here for speed; small results already confirmed above.

console.log('\nAll recordings — whisper-small FR+EN combined (mirrors browser worker):\n')
for (const file of NOTES) {
  const base = file.replace(/2$/, '')
  const expectedNote = base === 're' ? 'ré' : base

  const wavPath = resolve(__dir, 'examples', `${file}.wav`)
  const { samples, sampleRate } = decodeWav(readFileSync(wavPath))
  const audio = resample(samples, sampleRate, WHISPER_SR)

  const [resFr, resEn] = await Promise.all([
    transcriber(audio, { language: 'french',  task: 'transcribe' }),
    transcriber(audio, { language: 'english', task: 'transcribe' }),
  ])
  const combined = (resFr.text ?? '') + ' ' + (resEn.text ?? '')
  const detected  = extractNoteNew(combined) ?? '✗'
  const rawFr = resFr.text.trim().slice(0, 16)
  const rawEn = resEn.text.trim().slice(0, 16)
  const ok = detected === expectedNote
  console.log(`${ok ? '✅' : '❌'} ${file.padEnd(5)} │ FR:${JSON.stringify(rawFr).padEnd(18)} EN:${JSON.stringify(rawEn).padEnd(18)} → ${detected}`)
}
