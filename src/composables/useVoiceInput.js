import { ref, onUnmounted } from 'vue'
import KwsWorker from '../workers/kwsWorker.js?worker'

const NOTE_INDEX = { do: 0, ré: 1, mi: 2, fa: 3, sol: 4, la: 5, si: 6 }

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
  let worker = new KwsWorker()
  let workerReady = false

  worker.onmessage = (e) => {
    if (e.data.type === 'ready') {
      modelProgress.value = 100
      deviceType.value    = 'kws'
      workerReady         = true
    }
    if (e.data.type === 'result') handleResult(e.data)
    if (e.data.type === 'error')  { processingLocked = false }
  }
  worker.postMessage({ type: 'init' })

  // ── Result handling ──────────────────────────────────────────────
  let heardTimer = null
  let processingLocked = false

  function handleResult({ note, label, conf }) {
    processingLocked = false
    if (note === null || note === undefined) {
      rawTranscript.value = conf !== undefined ? `(${(conf*100).toFixed(0)}%)` : ''
      return
    }
    rawTranscript.value = label
    lastHeard.value     = label
    clearTimeout(heardTimer)
    heardTimer = setTimeout(() => { lastHeard.value = ''; rawTranscript.value = '' }, 1500)
    onNote(note)
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

  // Adaptive noise floor calibration over first ~1 s of quiet
  let noiseFloor      = 0.015
  let noiseCalFrames  = 0
  const NOISE_CAL_FRAMES  = 30
  const NOISE_FLOOR_MULT  = 3.5
  const MIN_THRESHOLD     = 0.012

  const SILENCE_FRAMES    = 18   // ~580 ms of silence → end of utterance
  const SPEECH_MIN_FRAMES = 3    // ignore pops shorter than ~100 ms
  const MAX_SPEECH_FRAMES = 90   // 3 s max utterance

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

    noiseFloor = 0.015; noiseCalFrames = 0

    processor.onaudioprocess = (ev) => {
      if (!isListening.value || !workerReady || processingLocked) return

      analyser.getFloatTimeDomainData(timeDomain)
      const rms = Math.sqrt(timeDomain.reduce((s, v) => s + v * v, 0) / timeDomain.length)

      if (!speaking && noiseCalFrames < NOISE_CAL_FRAMES) {
        noiseFloor = (noiseFloor * noiseCalFrames + rms) / (noiseCalFrames + 1)
        noiseCalFrames++
      }

      const sliderPct      = (micThreshold?.value ?? 0) / 100
      const multiplier     = NOISE_FLOOR_MULT - sliderPct * 2
      const energyThreshold = Math.max(noiseFloor * multiplier, MIN_THRESHOLD)

      micLevel.value = Math.min(rms * 4, 1)

      const pcm = ev.inputBuffer.getChannelData(0)

      if (rms > energyThreshold) {
        if (!speaking) { speaking = true; speechFrames = 0; pcmBuffer = [] }
        speechFrames++; silenceFrames = 0
        pcmBuffer.push(...pcm)

        if (speechFrames >= MAX_SPEECH_FRAMES) {
          speaking = false
          processingLocked = true
          worker.postMessage({ type: 'transcribe', audio: new Float32Array(pcmBuffer) })
          pcmBuffer = []; speechFrames = 0; silenceFrames = 0
          noiseCalFrames = 0
        }
      } else if (speaking) {
        silenceFrames++
        pcmBuffer.push(...pcm)
        if (silenceFrames > SILENCE_FRAMES) {
          speaking = false
          if (speechFrames > SPEECH_MIN_FRAMES) {
            processingLocked = true
            worker.postMessage({ type: 'transcribe', audio: new Float32Array(pcmBuffer) })
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
