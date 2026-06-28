import { ref, onUnmounted } from 'vue'
import WhisperWorker from '../workers/whisperWorker.js?worker'

// Aliases derived from empirical whisper-small FR output on the 7 note recordings.
// Repeated chars are collapsed before lookup ("Dooooo" → "do", "Faaah" → "fah").
const ALIASES = {
  do: 'do', doe: 'do', dou: 'do',
  ré: 'ré', re: 'ré', ray: 'ré', reh: 'ré',
  mi: 'mi', me: 'mi', mee: 'mi',
  fa: 'fa', fah: 'fa', fuh: 'fa', far: 'fa',
  sol: 'sol', so: 'sol', soul: 'sol', sole: 'sol',
  la: 'la', là: 'la', lah: 'la',
  si: 'si', see: 'si', sea: 'si',
}

const NOTE_INDEX = { do: 0, ré: 1, mi: 2, fa: 3, sol: 4, la: 5, si: 6 }

// Collapse repeated chars ("Dooooo" → "do") then strip non-letter chars
function normalizeWord(raw) {
  return raw
    .toLowerCase()
    .replace(/(.)\1+/g, '$1')           // "oooo" → "o"
    .replace(/[^a-zàâéèêëîïôùûüç]/g, '') // keep only letters
}

function extractNote(transcript) {
  for (const word of transcript.trim().split(/\s+/)) {
    const canonical = ALIASES[normalizeWord(word)]
    if (canonical !== undefined) return canonical
  }
  return null
}

const WHISPER_SR = 16000

export function useVoiceInput({ lang, onNote, micThreshold }) {
  const isSupported   = ref(true)
  const isListening   = ref(false)
  const lastHeard     = ref('')
  const rawTranscript = ref('')
  const modelProgress = ref(0)
  const micLevel      = ref(0)
  const deviceType    = ref('loading')

  // ── Worker ───────────────────────────────────────────────────────
  let worker = new WhisperWorker()
  let workerReady = false

  worker.onmessage = (e) => {
    if (e.data.type === 'progress') modelProgress.value = e.data.pct
    if (e.data.type === 'ready') {
      modelProgress.value = 100
      deviceType.value = e.data.device
      workerReady = true
    }
    if (e.data.type === 'result') handleResult(e.data.text)
  }
  worker.postMessage({ type: 'init' })

  // ── Result handling ──────────────────────────────────────────────
  let heardTimer = null
  let processingLocked = false

  function handleResult(text) {
    processingLocked = false
    rawTranscript.value = text.trim()
    const canonical = extractNote(text)
    if (!canonical) return
    lastHeard.value = canonical
    clearTimeout(heardTimer)
    heardTimer = setTimeout(() => { lastHeard.value = ''; rawTranscript.value = '' }, 1500)
    onNote(NOTE_INDEX[canonical])
  }

  // ── Audio capture ────────────────────────────────────────────────
  let audioCtx  = null
  let analyser  = null
  let processor = null
  let stream    = null

  // VAD state
  let speaking      = false
  let silenceFrames = 0
  let speechFrames  = 0
  let pcmBuffer     = []

  // Adaptive noise floor — calibrates to room noise over first ~30 frames (~1 s)
  let noiseFloor      = 0.015
  let noiseCalFrames  = 0
  const NOISE_CAL_FRAMES  = 30   // frames used for initial calibration
  const NOISE_FLOOR_MULT  = 3.5  // threshold = noiseFloor × this
  const MIN_THRESHOLD     = 0.012

  const SILENCE_FRAMES    = 18   // ~580 ms of silence → end of utterance
  const SPEECH_MIN_FRAMES = 3    // ignore pops shorter than ~100 ms
  const MAX_SPEECH_FRAMES = 90   // ~3 s max utterance; send even without silence

  async function startCapture() {
    audioCtx = new AudioContext({ sampleRate: WHISPER_SR })
    stream   = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })

    const source = audioCtx.createMediaStreamSource(stream)
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)

    processor = audioCtx.createScriptProcessor(512, 1, 1)
    analyser.connect(processor)
    processor.connect(audioCtx.destination)

    const timeDomain = new Float32Array(analyser.fftSize)

    // Reset noise calibration on each new capture session
    noiseFloor = 0.015; noiseCalFrames = 0

    processor.onaudioprocess = (ev) => {
      if (!isListening.value || !workerReady || processingLocked) return

      analyser.getFloatTimeDomainData(timeDomain)
      const rms = Math.sqrt(timeDomain.reduce((s, v) => s + v * v, 0) / timeDomain.length)

      // Adaptive noise floor: average quiet frames at start to estimate ambient level
      if (!speaking && noiseCalFrames < NOISE_CAL_FRAMES) {
        noiseFloor = (noiseFloor * noiseCalFrames + rms) / (noiseCalFrames + 1)
        noiseCalFrames++
      }

      // Slider (0–90) shifts threshold: 0 = 3.5× noiseFloor, 90 = 1.5× noiseFloor
      const sliderPct = (micThreshold?.value ?? 0) / 100
      const multiplier = NOISE_FLOOR_MULT - sliderPct * 2   // 3.5 → 1.5
      const energyThreshold = Math.max(noiseFloor * multiplier, MIN_THRESHOLD)

      micLevel.value = Math.min(rms * 4, 1)

      const pcm = ev.inputBuffer.getChannelData(0)

      if (rms > energyThreshold) {
        if (!speaking) { speaking = true; speechFrames = 0; pcmBuffer = [] }
        speechFrames++; silenceFrames = 0
        pcmBuffer.push(...pcm)

        // Safety valve: send after max utterance length even without silence
        if (speechFrames >= MAX_SPEECH_FRAMES) {
          speaking = false
          processingLocked = true
          worker.postMessage({ type: 'transcribe', audio: new Float32Array(pcmBuffer), samplingRate: WHISPER_SR, lang: lang.value })
          pcmBuffer = []; speechFrames = 0; silenceFrames = 0
          // Re-calibrate noise floor after sending
          noiseCalFrames = 0
        }
      } else if (speaking) {
        silenceFrames++
        pcmBuffer.push(...pcm)
        if (silenceFrames > SILENCE_FRAMES) {
          speaking = false
          if (speechFrames > SPEECH_MIN_FRAMES) {
            processingLocked = true
            worker.postMessage({ type: 'transcribe', audio: new Float32Array(pcmBuffer), samplingRate: WHISPER_SR, lang: lang.value })
          }
          pcmBuffer = []; silenceFrames = 0; speechFrames = 0
        }
      }
    }
  }

  function stopCapture() {
    processor?.disconnect(); processor = null
    analyser?.disconnect();  analyser  = null
    stream?.getTracks().forEach(t => t.stop()); stream = null
    audioCtx?.close(); audioCtx = null
    speaking = false; pcmBuffer = []; silenceFrames = 0; speechFrames = 0
    processingLocked = false
    micLevel.value = 0
    noiseFloor = 0.015; noiseCalFrames = 0
  }

  function toggle() {
    if (isListening.value) {
      isListening.value = false
      stopCapture()
    } else {
      isListening.value = true
      startCapture().catch(() => { isListening.value = false })
    }
  }

  onUnmounted(() => {
    stopCapture()
    worker?.terminate()
    clearTimeout(heardTimer)
  })

  return { isSupported, isListening, lastHeard, rawTranscript, modelProgress, deviceType, micLevel, toggle }
}
