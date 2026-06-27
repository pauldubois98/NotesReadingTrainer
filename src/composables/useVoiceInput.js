import { ref, watch, onUnmounted } from 'vue'

// Maps what the browser might transcribe → canonical lowercase note name
const ALIASES = {
  do: 'do', doe: 'do',
  ré: 'ré', re: 'ré', ray: 'ré', reh: 'ré',
  mi: 'mi', me: 'mi',
  fa: 'fa',
  sol: 'sol', soul: 'sol', sole: 'sol',
  la: 'la',
  si: 'si', see: 'si', sea: 'si',
}

// Canonical note name → answer index (0 = Do … 6 = Si)
const NOTE_INDEX = { do: 0, ré: 1, mi: 2, fa: 3, sol: 4, la: 5, si: 6 }

// Strip everything except letters + é, return first note word found in transcript
function extractNote(transcript) {
  const words = transcript.trim().toLowerCase().split(/\s+/)
  for (const word of words) {
    const clean = word.replace(/[^a-zé]/g, '')
    const canonical = ALIASES[clean]
    if (canonical !== undefined) return canonical
  }
  return null
}

export function useVoiceInput({ lang, onNote, micThreshold }) {
  const SR = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null

  const isSupported = ref(!!SR)
  const isListening = ref(false)
  const lastHeard = ref('')

  if (!SR) return { isSupported, isListening, lastHeard, toggle: () => {} }

  let recognition = null
  let heardTimer = null

  function buildRecognition() {
    if (recognition) { recognition.abort(); recognition = null }

    recognition = new SR()
    recognition.continuous = true
    recognition.interimResults = false
    // NOTE: SpeechGrammarList is intentionally omitted — in Chrome 90+ it can
    // suppress onresult entirely when audio doesn't perfectly match the grammar.
    recognition.lang = lang.value === 'fr' ? 'fr-FR' : 'en-US'

    recognition.onresult = (e) => {
      // Scan every new final result in this event
      const threshold = (micThreshold?.value ?? 0) / 100
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue
        const confidence = e.results[i][0].confidence
        // confidence=0 means the browser didn't provide a score — let it through
        if (threshold > 0 && confidence > 0 && confidence < threshold) continue
        const transcript = e.results[i][0].transcript
        const canonical = extractNote(transcript)
        if (canonical === null) continue

        const idx = NOTE_INDEX[canonical]
        if (idx === undefined) continue

        lastHeard.value = canonical
        if (heardTimer) clearTimeout(heardTimer)
        heardTimer = setTimeout(() => { lastHeard.value = '' }, 900)

        onNote(idx)
        break  // one note per event
      }
    }

    recognition.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        isListening.value = false
      }
      // other errors (network, aborted) are transient — onend will restart
    }

    recognition.onend = () => {
      // Browser stops after ~60 s of silence; restart while still active
      if (isListening.value) {
        try { recognition.start() } catch (_) {}
      }
    }
  }

  function toggle() {
    if (isListening.value) {
      isListening.value = false
      recognition?.abort()
    } else {
      buildRecognition()
      isListening.value = true
      recognition.start()
    }
  }

  // Rebuild with correct locale when the user switches language
  watch(() => lang.value, () => {
    if (isListening.value) {
      recognition?.abort()
      buildRecognition()
      try { recognition.start() } catch (_) {}
    }
  })

  onUnmounted(() => {
    isListening.value = false
    recognition?.abort()
    if (heardTimer) clearTimeout(heardTimer)
  })

  return { isSupported, isListening, lastHeard, toggle }
}
