import { ref, watch, onUnmounted } from 'vue'
import WhisperWorker from '../workers/whisperWorker.js?worker'

// Maps browser transcription variants → canonical lowercase note name
const ALIASES = {
  do: 'do', doe: 'do',
  ré: 'ré', re: 'ré', ray: 'ré', reh: 'ré',
  mi: 'mi', me: 'mi',
  fa: 'fa',
  sol: 'sol', soul: 'sol', sole: 'sol',
  la: 'la',
  si: 'si', see: 'si', sea: 'si',
}

const NOTE_INDEX = { do: 0, ré: 1, mi: 2, fa: 3, sol: 4, la: 5, si: 6 }

function extractNote(transcript) {
  for (const word of transcript.trim().toLowerCase().split(/\s+/)) {
    const canonical = ALIASES[word.replace(/[^a-zé]/g, '')]
    if (canonical !== undefined) return canonical
  }
  return null
}

// Target sample rate Whisper expects
const WHISPER_SR = 16000

export function useVoiceInput({ lang, onNote, micThreshold }) {
  const isSupported   = ref(true)
  const isListening   = ref(false)
  const lastHeard     = ref('')
  const modelProgress = ref(0)
  const micLevel        = ref(0)     // live RMS 0-1 for the UI meter
  const rawTranscript  = ref('')    // last raw Whisper output (debug)
  const isRecordingPTT = ref(false) // true while Space is held
  // 'loading' | 'webgpu' | 'wasm'
  const deviceType     = ref('loading')

  // ── Worker ───────────────────────────────────────────────────────
  let worker = new WhisperWorker()
  let workerReady = false

  worker.onmessage = (e) => {
    if (e.data.type === 'progress') {
      modelProgress.value = e.data.pct
    }
    if (e.data.type === 'ready') {
      modelProgress.value = 100
      deviceType.value = e.data.device   // 'webgpu' | 'wasm'
      workerReady = true
    }
    if (e.data.type === 'result') {
      handleResult(e.data.text)
    }
  }

  // Start model download immediately (cached after first run)
  worker.postMessage({ type: 'init' })

  // ── Result handling ──────────────────────────────────────────────
  let heardTimer = null
  let processingLocked = false

  function handleResult(text) {
    processingLocked = false
    rawTranscript.value = text.trim()           // always show what Whisper said
    const canonical = extractNote(text)
    if (!canonical) return
    lastHeard.value = canonical
    clearTimeout(heardTimer)
    heardTimer = setTimeout(() => { lastHeard.value = ''; rawTranscript.value = '' }, 1500)
    onNote(NOTE_INDEX[canonical])
  }

  // ── Audio capture + VAD ──────────────────────────────────────────
  let audioCtx    = null
  let analyser    = null
  let processor   = null   // ScriptProcessorNode (widely supported)
  let stream      = null

  // VAD state
  let speaking     = false
  let silenceFrames = 0
  let speechFrames  = 0
  let pcmBuffer     = []
  const SILENCE_FRAMES   = 20   // ~600 ms silence → end of utterance
  const SPEECH_MIN_FRAMES = 3   // ignore pops shorter than ~90 ms

  async function startCapture() {
    audioCtx = new AudioContext({ sampleRate: WHISPER_SR })
    stream   = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })

    const source = audioCtx.createMediaStreamSource(stream)
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)

    // ScriptProcessorNode collects raw PCM at WHISPER_SR
    processor = audioCtx.createScriptProcessor(512, 1, 1)
    analyser.connect(processor)
    processor.connect(audioCtx.destination)

    const timeDomain = new Float32Array(analyser.fftSize)

    processor.onaudioprocess = (ev) => {
      if (!isListening.value || !workerReady || processingLocked) return

      analyser.getFloatTimeDomainData(timeDomain)
      const rms = Math.sqrt(timeDomain.reduce((s, v) => s + v * v, 0) / timeDomain.length)

      // Adjust energy threshold via micThreshold slider (0 = off = 0.012 floor)
      // Slider is "sensitivity": 0% = quietest mic (highest threshold),
      // 90% = most sensitive (lowest threshold catches soft speech)
      const sliderPct = (micThreshold?.value ?? 0) / 100
      const energyThreshold = 0.10 - sliderPct * 0.088   // 0% → 0.10,  90% → 0.012

      const pcm = ev.inputBuffer.getChannelData(0)

      // Normalise RMS to 0-1 for the UI meter (speech ≈ 0.05-0.3 → scale ×4)
      micLevel.value = Math.min(rms * 4, 1)

      // Push-to-talk capture — always runs while mic is open
      if (pttActive) pttBuffer.push(...pcm)

      if (rms > energyThreshold) {
        if (!speaking) { speaking = true; speechFrames = 0; pcmBuffer = [] }
        speechFrames++
        silenceFrames = 0
        pcmBuffer.push(...pcm)
      } else if (speaking) {
        silenceFrames++
        pcmBuffer.push(...pcm)   // include trailing silence for natural word boundary
        if (silenceFrames > SILENCE_FRAMES) {
          speaking = false
          if (speechFrames > SPEECH_MIN_FRAMES) {
            processingLocked = true
            const audio = new Float32Array(pcmBuffer)
            worker.postMessage({ type: 'transcribe', audio, samplingRate: WHISPER_SR, lang: lang.value })
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
  }

  // ── Push-to-talk (Space key) ─────────────────────────────────────
  // Bypasses the VAD entirely: record while Space is held, send on release.
  let pttActive = false
  let pttBuffer = []

  function onKeyDown(e) {
    if (e.code !== 'Space' || e.repeat) return
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return
    if (!workerReady || processingLocked) return
    if (!audioCtx) return          // mic not yet open
    e.preventDefault()
    pttActive = true
    pttBuffer = []
    isRecordingPTT.value = true
  }

  function onKeyUp(e) {
    if (e.code !== 'Space' || !pttActive) return
    e.preventDefault()
    pttActive = false
    isRecordingPTT.value = false
    if (pttBuffer.length > 0 && !processingLocked) {
      processingLocked = true
      const audio = new Float32Array(pttBuffer)
      worker.postMessage({ type: 'transcribe', audio, samplingRate: WHISPER_SR, lang: lang.value })
    }
    pttBuffer = []
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup',   onKeyUp)

  // ── Public API ───────────────────────────────────────────────────
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
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup',   onKeyUp)
    stopCapture()
    worker?.terminate()
    clearTimeout(heardTimer)
  })

  return { isSupported, isListening, isRecordingPTT, lastHeard, rawTranscript, modelProgress, deviceType, micLevel, toggle }
}
