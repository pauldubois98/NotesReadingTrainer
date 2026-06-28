import { ref, onUnmounted } from 'vue'
import KwsWorker from '../workers/kwsWorker.js?worker'

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
  }
  worker.postMessage({ type: 'init' })

  // ── Result handling ──────────────────────────────────────────────
  let heardTimer       = null
  let processingLocked = false
  let lastNoteAt       = 0          // debounce: ms timestamp of last accepted note
  const DEBOUNCE_MS    = 700        // ignore new detections for this long after a hit

  function handleResult({ note, label, conf }) {
    processingLocked = false
    if (note === null || note === undefined) return

    const now = performance.now()
    if (now - lastNoteAt < DEBOUNCE_MS) return   // too soon after last accepted note
    lastNoteAt = now

    rawTranscript.value = label
    lastHeard.value     = label
    clearTimeout(heardTimer)
    heardTimer = setTimeout(() => { lastHeard.value = ''; rawTranscript.value = '' }, 1500)
    onNote(note)
  }

  // ── Audio capture — sliding-window ───────────────────────────────
  //
  // A 1-second ring buffer is maintained at all times.
  // Every INFER_EVERY_FRAMES (≈200 ms), if recent energy is above the
  // noise threshold, a snapshot of the buffer is sent for inference.
  // No silence-wait is needed: the MLP runs in <1 ms.
  //
  let audioCtx  = null
  let analyser  = null
  let processor = null
  let stream    = null

  const FRAME_SAMPLES  = 512                        // samples per onaudioprocess callback (32 ms)
  const RING_SAMPLES   = WHISPER_SR                 // 1 second ring buffer
  const INFER_EVERY    = 6                          // run inference every N frames ≈ 192 ms
  const ENERGY_FRAMES  = 4                          // frames averaged for energy gate

  let ringBuf       = new Float32Array(RING_SAMPLES)
  let ringHead      = 0     // next write position
  let frameClock    = 0     // counts callbacks since last inference
  let recentRms     = []    // last ENERGY_FRAMES rms values

  // Adaptive noise floor
  let noiseFloor     = 0.015
  let noiseCalFrames = 0
  const NOISE_CAL_FRAMES = 30
  const MIN_THRESHOLD    = 0.012

  async function startCapture() {
    ringBuf.fill(0); ringHead = 0; frameClock = 0; recentRms = []
    noiseFloor = 0.015; noiseCalFrames = 0

    audioCtx = new AudioContext({ sampleRate: WHISPER_SR })
    stream   = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })

    const source = audioCtx.createMediaStreamSource(stream)
    analyser     = audioCtx.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)

    processor = audioCtx.createScriptProcessor(FRAME_SAMPLES, 1, 1)
    analyser.connect(processor)
    processor.connect(audioCtx.destination)

    const timeDomain = new Float32Array(analyser.fftSize)

    processor.onaudioprocess = (ev) => {
      if (!isListening.value || !workerReady) return

      // ── 1. Write incoming frame into ring buffer (wrap around) ──
      const pcm = ev.inputBuffer.getChannelData(0)
      for (let i = 0; i < FRAME_SAMPLES; i++) {
        ringBuf[(ringHead + i) % RING_SAMPLES] = pcm[i]
      }
      ringHead = (ringHead + FRAME_SAMPLES) % RING_SAMPLES

      // ── 2. Compute RMS for mic meter + energy gate ──────────────
      analyser.getFloatTimeDomainData(timeDomain)
      const rms = Math.sqrt(timeDomain.reduce((s, v) => s + v * v, 0) / timeDomain.length)
      micLevel.value = Math.min(rms * 4, 1)

      // Calibrate noise floor on quiet frames
      if (noiseCalFrames < NOISE_CAL_FRAMES && rms < noiseFloor * 2) {
        noiseFloor = (noiseFloor * noiseCalFrames + rms) / (noiseCalFrames + 1)
        noiseCalFrames++
      }

      recentRms.push(rms)
      if (recentRms.length > ENERGY_FRAMES) recentRms.shift()

      // ── 3. Every INFER_EVERY frames, fire inference if speech detected ──
      frameClock++
      if (frameClock < INFER_EVERY) return
      frameClock = 0

      if (processingLocked) return

      const sliderPct       = (micThreshold?.value ?? 0) / 100
      const multiplier      = 3.5 - sliderPct * 2          // 3.5× → 1.5× noiseFloor
      const energyThreshold = Math.max(noiseFloor * multiplier, MIN_THRESHOLD)
      const avgRms          = recentRms.reduce((a, b) => a + b, 0) / recentRms.length

      if (avgRms < energyThreshold) return   // silence — skip inference

      // ── 4. Snapshot ring buffer in chronological order ──────────
      const snapshot = new Float32Array(RING_SAMPLES)
      const tail = RING_SAMPLES - ringHead
      snapshot.set(ringBuf.subarray(ringHead), 0)
      snapshot.set(ringBuf.subarray(0, ringHead), tail)

      processingLocked = true
      worker.postMessage({ type: 'transcribe', audio: snapshot })
    }
  }

  function stopCapture() {
    processor?.disconnect(); processor = null
    analyser?.disconnect();  analyser  = null
    stream?.getTracks().forEach(t => t.stop()); stream = null
    audioCtx?.close(); audioCtx = null
    processingLocked = false
    micLevel.value = 0
    ringBuf.fill(0); ringHead = 0; frameClock = 0; recentRms = []
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
