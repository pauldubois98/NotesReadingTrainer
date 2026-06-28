<template>
  <div class="app">
    <!-- ── Top-right toolbar: language + theme ─────────────────── -->
    <div class="topbar">
      <button
        v-for="l in ['fr', 'en']"
        :key="l"
        :class="['topbar-btn', { active: lang === l }]"
        @click="lang = l"
      >{{ l.toUpperCase() }}</button>
      <button class="topbar-btn topbar-icon" @click="toggleTheme" :title="isDark ? 'Light mode' : 'Dark mode'">
        {{ isDark ? '☀' : '☾' }}
      </button>
    </div>

    <!-- ── Setup screen ────────────────────────────────────────── -->
    <div v-if="screen === 'setup'" class="card setup-card">
      <h1 class="title">{{ t.title }}</h1>
      <p class="subtitle">{{ t.subtitle }}</p>

      <div class="settings">
        <!-- Clef -->
        <div class="setting-group">
          <label class="setting-label">{{ t.clef }}</label>
          <div class="toggle-group">
            <button
              v-for="c in ['sol', 'do', 'fa']"
              :key="c"
              :class="['toggle-btn', { active: clef === c }]"
              @click="selectClef(c)"
            >{{ t[`clef${c.charAt(0).toUpperCase() + c.slice(1)}`] }}</button>
          </div>
        </div>

        <!-- Instrument -->
        <div class="setting-group">
          <label class="setting-label">{{ t.instrument }}</label>
          <div class="toggle-group">
            <button
              v-for="id in availableInstruments"
              :key="id"
              :class="['toggle-btn', { active: instrument === id }]"
              @click="instrument = id"
            >{{ t.instruments[id] }}</button>
          </div>
        </div>

        <!-- Past notes slider -->
        <div class="setting-group">
          <label class="setting-label">
            {{ t.pastNotes }} — <span class="slider-value">{{ maxHistory }}</span>
          </label>
          <input type="range" min="0" max="5" v-model.number="maxHistory" class="slider" />
        </div>

      </div>

      <!-- Staff preview -->
      <MusicStaff :note-history="previewHistory" :clef="clef" :max-history="maxHistory" />

      <button class="btn-primary btn-large" @click="startGame">{{ t.start }}</button>
    </div>

    <!-- ── Game screen ─────────────────────────────────────────── -->
    <div v-else-if="screen === 'game'" class="card game-card">
      <!-- Header -->
      <div class="game-header">
        <div class="stat">
          <span class="stat-label">{{ t.errors }}</span>
          <span class="stat-value error-val">{{ errors }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">{{ t.score }}</span>
          <span class="stat-value">{{ correct }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">{{ t.time }}</span>
          <span class="stat-value">{{ formattedTime }}</span>
        </div>
      </div>

      <!-- Context badge -->
      <div class="context-badge">
        <span>{{ t[`clef${clef.charAt(0).toUpperCase() + clef.slice(1)}`] }}</span>
        <span class="context-sep">·</span>
        <span>{{ t.instruments[instrument] }}</span>
      </div>

      <!-- Staff -->
      <div class="staff-area">
        <MusicStaff :note-history="noteHistory" :clef="clef" :feedback="feedback" :max-history="maxHistory" />
        <div v-if="paused" class="pause-overlay">{{ t.paused }}</div>
      </div>

      <!-- Note buttons -->
      <div class="note-buttons">
        <button
          v-for="(note, idx) in t.notes"
          :key="idx"
          :class="['note-btn', answerClass(idx)]"
          :disabled="paused"
          @click="answer(idx)"
        >{{ note }}</button>
      </div>

      <!-- Model loading bar / device badge -->
      <div v-if="voiceSupported" class="model-status">
        <template v-if="modelProgress < 100">
          <span class="model-loading-label">{{ t.modelLoading }} {{ modelProgress }}%</span>
          <div class="model-bar-wrap">
            <div class="model-bar" :style="{ width: modelProgress + '%' }" />
          </div>
        </template>
        <span v-else :class="['device-badge', deviceType]">
          {{ deviceType === 'webgpu' ? '⚡ WebGPU' : '🖥 CPU' }}
        </span>
      </div>

      <!-- Voice status row -->
      <div class="voice-status-row">
        <!-- PTT hint / recording flash -->
        <div v-if="isListening" class="ptt-hint" :class="{ recording: isRecordingPTT }">
          {{ isRecordingPTT ? '⏺ ' + t.pttRecording : t.pttHint }}
        </div>

        <!-- Heard / raw transcript -->
        <div class="voice-heard" :class="{ visible: lastHeard || rawTranscript }">
          <template v-if="lastHeard">
            {{ t.voiceHeard }}: <strong>{{ lastHeard }}</strong>
          </template>
          <template v-else-if="rawTranscript">
            🔍 "<em>{{ rawTranscript }}</em>"
          </template>
        </div>
      </div>

      <!-- Controls -->
      <div class="controls">
        <button class="btn-secondary" @click="togglePause">
          {{ paused ? t.resume : t.pause }}
        </button>
        <button
          v-if="voiceSupported"
          :class="['btn-mic', { active: isListening, recording: isRecordingPTT }]"
          :title="isListening ? t.voiceOff : t.voiceOn"
          :disabled="paused || modelProgress < 100"
          @click="toggleVoice"
        >🎤</button>
        <button class="btn-skip" :disabled="paused || !!feedback" @click="skipNote">{{ t.skip }}</button>
        <button class="btn-danger" @click="stopGame">{{ t.stop }}</button>
        <button class="btn-quit" @click="quitGame">{{ t.quit }}</button>
      </div>

      <!-- Mic level meter (visible while listening) -->
      <div v-if="isListening" class="mic-meter-wrap">
        <div
          class="mic-meter-bar"
          :class="{ speaking: micLevel > thresholdFraction }"
          :style="{ width: (micLevel * 100).toFixed(1) + '%' }"
        />
        <div class="mic-meter-threshold" :style="{ left: (thresholdFraction * 100).toFixed(1) + '%' }" />
      </div>

      <!-- Mic threshold (shown only while voice is active) -->
      <div v-if="voiceSupported && isListening" class="mic-threshold-row">
        <label class="setting-label">
          🎤 {{ t.micThreshold }} —
          <span class="slider-value">{{ micThreshold === 0 ? t.micOff : micThreshold + '%' }}</span>
        </label>
        <input type="range" min="0" max="90" step="5" v-model.number="micThreshold" class="slider" />
      </div>
    </div>

    <!-- ── Summary screen ──────────────────────────────────────── -->
    <div v-else-if="screen === 'summary'" class="card summary-card">
      <h2 class="summary-title">{{ t.summary }}</h2>

      <div class="summary-stats">
        <div class="summary-stat">
          <span class="summary-label">{{ t.totalNotes }}</span>
          <span class="summary-value">{{ correct + errors }}</span>
        </div>
        <div class="summary-stat">
          <span class="summary-label">{{ t.score }}</span>
          <span class="summary-value correct-val">{{ correct }}</span>
        </div>
        <div class="summary-stat">
          <span class="summary-label">{{ t.errors }}</span>
          <span class="summary-value error-val">{{ errors }}</span>
        </div>
        <div class="summary-stat">
          <span class="summary-label">{{ t.time }}</span>
          <span class="summary-value">{{ formattedTotalTime }}</span>
        </div>
        <div class="summary-stat">
          <span class="summary-label">{{ t.avgTime }}</span>
          <span class="summary-value">{{ avgTimePerNote }}</span>
        </div>
      </div>

      <!-- Per-note breakdown -->
      <div class="note-breakdown">
        <div v-for="(note, idx) in t.notes" :key="idx" class="breakdown-row">
          <span class="breakdown-note">{{ note }}</span>
          <div class="breakdown-bar-wrap">
            <div class="breakdown-bar" :style="{ width: breakdownBarWidth(idx) + '%' }" />
          </div>
          <span class="breakdown-count">
            {{ noteStats[idx]?.correct ?? 0 }}/{{ (noteStats[idx]?.correct ?? 0) + (noteStats[idx]?.wrong ?? 0) }}
          </span>
        </div>
      </div>

      <div class="summary-actions">
        <button class="btn-primary btn-large" @click="playAgain">{{ t.playAgain }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import MusicStaff from './components/MusicStaff.vue'
import { useI18n, INSTRUMENTS_BY_CLEF } from './i18n.js'
import { useVoiceInput } from './composables/useVoiceInput.js'

// --- Theme ---
const isDark = ref(true)
function toggleTheme() {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle('light', !isDark.value)
}

// --- i18n ---
const lang = ref('fr')
const t = computed(() => useI18n(lang.value))

// --- Settings ---
const clef = ref('sol')
const instrument = ref('piano')
const maxHistory = ref(3)
const micThreshold = ref(0)  // 0–90, used as confidence threshold / 100

const availableInstruments = computed(() => INSTRUMENTS_BY_CLEF[clef.value] ?? [])

function selectClef(c) {
  clef.value = c
  // Reset to first available instrument for this clef
  instrument.value = INSTRUMENTS_BY_CLEF[c][0]
}

// Note names index (0=Do, 1=Re, 2=Mi, 3=Fa, 4=Sol, 5=La, 6=Si)
// Offset = note index of the bottom line (pos 0) for each clef
function clefOffset(clefType) {
  if (clefType === 'sol') return 2  // Mi on bottom line
  if (clefType === 'do')  return 3  // Fa on bottom line (alto C clef)
  return 4                          // Sol on bottom line (bass clef)
}

const MIN_POS = -4
const MAX_POS = 12

function noteNameIndex(position, clefType) {
  const offset = clefOffset(clefType)
  return ((offset + position) % 7 + 7) % 7
}

// --- Game state ---
const screen = ref('setup')
const noteHistory = ref([])   // [{id, pos, result}], last item is always the current note
let noteIdCounter = 0
const feedback = ref(null)
const correct = ref(0)
const errors = ref(0)
const paused = ref(false)
const noteStats = ref(Array.from({ length: 7 }, () => ({ correct: 0, wrong: 0 })))

let timerInterval = null
const elapsedMs = ref(0)
let feedbackTimeout = null

const currentPos = computed(() => noteHistory.value.at(-1)?.pos ?? null)
const previewHistory = computed(() => [{ id: -1, pos: 4, result: null }])

// --- Computed ---
const formattedTime = computed(() => {
  const s = Math.floor(elapsedMs.value / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
})

const formattedTotalTime = computed(() => formattedTime.value)

const avgTimePerNote = computed(() => {
  const total = correct.value + errors.value
  if (total === 0) return '—'
  return (elapsedMs.value / total / 1000).toFixed(1) + ' ' + t.value.seconds
})

function breakdownBarWidth(idx) {
  const s = noteStats.value[idx]
  if (!s) return 0
  const total = s.correct + s.wrong
  return total === 0 ? 0 : Math.round((s.correct / total) * 100)
}

// --- Game logic ---
function pickNextNote() {
  let pos
  do {
    pos = Math.floor(Math.random() * (MAX_POS - MIN_POS + 1)) + MIN_POS
  } while (pos === currentPos.value)
  const next = [...noteHistory.value, { id: noteIdCounter++, pos, result: null }]
  noteHistory.value = next.slice(-6) // keep enough for the max slider value (5 past + 1 current)
}

function startGame() {
  screen.value = 'game'
  correct.value = 0
  errors.value = 0
  elapsedMs.value = 0
  paused.value = false
  noteStats.value = Array.from({ length: 7 }, () => ({ correct: 0, wrong: 0 }))
  feedback.value = null
  noteHistory.value = []
  noteIdCounter = 0
  pickNextNote()
  startTimer()
}

function startTimer() {
  let lastTick = performance.now()
  timerInterval = setInterval(() => {
    const now = performance.now()
    if (!paused.value) elapsedMs.value += now - lastTick
    lastTick = now
  }, 100)
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null }
}

function answer(noteIdx) {
  if (paused.value || feedback.value) return
  if (currentPos.value === null) return
  const expected = noteNameIndex(currentPos.value, clef.value)
  const isCorrect = noteIdx === expected

  if (isCorrect) {
    correct.value++
    noteStats.value[expected].correct++
    feedback.value = 'correct'
    const h = [...noteHistory.value]
    h[h.length - 1] = { ...h[h.length - 1], result: 'correct' }
    noteHistory.value = h
  } else {
    errors.value++
    noteStats.value[expected].wrong++
    feedback.value = 'wrong'
  }

  if (feedbackTimeout) clearTimeout(feedbackTimeout)
  feedbackTimeout = setTimeout(() => {
    feedback.value = null
    if (isCorrect) pickNextNote()
  }, 400)
}

function answerClass(idx) {
  if (!feedback.value) return ''
  const expected = noteNameIndex(currentPos.value, clef.value)
  if (feedback.value === 'correct' && idx === expected) return 'btn-correct'
  if (feedback.value === 'wrong'   && idx === expected) return 'btn-highlight'
  return ''
}

function skipNote() {
  if (feedbackTimeout) clearTimeout(feedbackTimeout)
  feedback.value = null
  pickNextNote()
}

function togglePause() { paused.value = !paused.value }

function quitGame() {
  stopTimer()
  if (feedbackTimeout) clearTimeout(feedbackTimeout)
  if (isListening.value) toggleVoice()
  feedback.value = null
  noteHistory.value = []
  screen.value = 'setup'
}

function stopGame() {
  stopTimer()
  if (feedbackTimeout) clearTimeout(feedbackTimeout)
  if (isListening.value) toggleVoice()
  screen.value = 'summary'
}

function playAgain() {
  screen.value = 'setup'
  noteHistory.value = []
}

// Fraction of the meter bar where the current VAD threshold sits (for the marker line)
// Mirrors: energyThreshold = 0.10 - sliderPct * 0.088, then ×4 to match the meter scaling
const thresholdFraction = computed(() => {
  const sliderPct = micThreshold.value / 100
  const energy = 0.10 - sliderPct * 0.088
  return Math.min(energy * 4, 1)
})

// --- Voice input ---
const { isSupported: voiceSupported, isListening, isRecordingPTT, lastHeard, rawTranscript, modelProgress, deviceType, micLevel, toggle: toggleVoice } =
  useVoiceInput({ lang, onNote: answer, micThreshold })

onBeforeUnmount(() => {
  stopTimer()
  if (feedbackTimeout) clearTimeout(feedbackTimeout)
})
</script>

<style scoped>
.app {
  width: 100%;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  padding-top: 56px;
}

/* Top-right toolbar */
.topbar {
  position: fixed;
  top: 12px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  z-index: 100;
}

.topbar-btn {
  padding: 5px 10px;
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 0.8rem;
  font-weight: 600;
  border: 1px solid transparent;
}

.topbar-btn.active {
  background: var(--primary);
  color: white;
}

.topbar-btn:hover:not(.active) {
  border-color: var(--border);
  color: var(--text);
}

.topbar-icon {
  font-size: 1rem;
  padding: 5px 9px;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 32px 28px;
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Setup */
.title {
  font-size: 1.6rem;
  font-weight: 700;
  text-align: center;
}

.subtitle {
  color: var(--text-muted);
  text-align: center;
  font-size: 0.9rem;
  margin-top: -8px;
}

.settings {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.setting-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

.toggle-group {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.toggle-btn {
  padding: 7px 14px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 0.85rem;
  font-weight: 500;
  border: 1px solid transparent;
}

.toggle-btn.active {
  background: var(--primary);
  color: white;
  border-color: var(--primary);
}

.toggle-btn:hover:not(.active) {
  border-color: var(--border);
  color: var(--text);
}

/* Buttons */
.btn-primary {
  background: var(--primary);
  color: white;
  border-radius: var(--radius-sm);
  padding: 12px 24px;
  font-weight: 600;
}

.btn-primary:hover { background: var(--primary-hover); }

.btn-large {
  width: 100%;
  font-size: 1.1rem;
  padding: 14px;
}

.btn-secondary {
  background: var(--surface-2);
  color: var(--text);
  border-radius: var(--radius-sm);
  padding: 10px 20px;
  font-weight: 500;
  flex: 1;
}

.btn-secondary:hover { background: var(--border); }

.slider {
  width: 100%;
  accent-color: var(--primary);
  cursor: pointer;
}

.slider-value {
  color: var(--primary);
  font-weight: 700;
}

.btn-mic {
  background: var(--surface-2);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  border: 1px solid transparent;
  color: var(--text-muted);
  font-size: 1.1rem;
  flex: 0 0 auto;
}
.btn-mic.active { border-color: var(--primary); color: var(--primary); animation: pulse-mic 1.8s ease infinite; }
.btn-mic.recording { border-color: var(--error); color: var(--error); animation: none; background: color-mix(in srgb, var(--error) 12%, var(--surface-2)); }
.btn-mic:disabled { opacity: 0.4; cursor: not-allowed; }

@keyframes pulse-mic {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--primary) 40%, transparent); }
  50%       { box-shadow: 0 0 0 6px color-mix(in srgb, var(--primary) 0%, transparent); }
}

.model-status {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.model-loading-label { color: var(--text-muted); }

.model-bar-wrap {
  height: 4px;
  background: var(--surface-2);
  border-radius: 2px;
  overflow: hidden;
}

.model-bar {
  height: 100%;
  background: var(--primary);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.device-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 99px;
  background: var(--surface-2);
  color: var(--text-muted);
  width: fit-content;
}
.device-badge.webgpu { color: var(--primary); border: 1px solid var(--primary); }
.device-badge.wasm   { color: var(--text-muted); border: 1px solid var(--border); }

.mic-meter-wrap {
  position: relative;
  height: 8px;
  background: var(--surface-2);
  border-radius: 4px;
  overflow: visible;
}

.mic-meter-bar {
  height: 100%;
  background: var(--success);
  border-radius: 4px;
  transition: width 0.05s linear, background 0.1s ease;
  min-width: 0;
}

.mic-meter-bar.speaking {
  background: var(--primary);
}

/* Threshold marker — vertical tick above the bar */
.mic-meter-threshold {
  position: absolute;
  top: -4px;
  width: 2px;
  height: 16px;
  background: var(--error);
  border-radius: 1px;
  transform: translateX(-50%);
  pointer-events: none;
}

.mic-threshold-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 2px 0;
}

.voice-status-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-height: 2.4em;
}

.ptt-hint {
  font-size: 0.72rem;
  color: var(--text-muted);
  letter-spacing: 0.03em;
}

.ptt-hint.recording {
  color: var(--error);
  font-weight: 600;
  animation: blink 0.7s step-start infinite;
}

@keyframes blink {
  50% { opacity: 0.3; }
}

.voice-heard {
  text-align: center;
  font-size: 0.82rem;
  color: var(--text-muted);
  min-height: 1.3em;
  opacity: 0;
  transition: opacity 0.2s ease;
}
.voice-heard.visible { opacity: 1; }

.btn-quit {
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  padding: 10px 16px;
  font-weight: 500;
  border: 1px solid var(--border);
  flex: 1;
}

.btn-quit:hover { border-color: var(--text-muted); color: var(--text); }

.btn-skip {
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  padding: 10px 16px;
  font-weight: 500;
  border: 1px solid var(--border);
  flex: 1;
}

.btn-skip:hover:not(:disabled) { border-color: var(--text-muted); color: var(--text); }
.btn-skip:disabled { opacity: 0.35; cursor: not-allowed; }

.btn-danger {
  background: transparent;
  color: var(--error);
  border-radius: var(--radius-sm);
  padding: 10px 20px;
  font-weight: 500;
  border: 1px solid var(--error);
  flex: 1;
}

.btn-danger:hover { background: var(--error); color: white; }

/* Game */
.game-header {
  display: flex;
  justify-content: space-around;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.stat-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.stat-value {
  font-size: 1.4rem;
  font-weight: 700;
}

.error-val { color: var(--error); }
.correct-val { color: var(--success); }

.context-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-top: -8px;
}

.context-sep { opacity: 0.4; }

.staff-area {
  position: relative;
}

.pause-overlay {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--text-muted);
  backdrop-filter: blur(2px);
}

.note-buttons {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
}

.note-btn {
  background: var(--surface-2);
  color: var(--text);
  border-radius: var(--radius-sm);
  padding: 14px 4px;
  font-size: 0.9rem;
  font-weight: 600;
  border: 1px solid transparent;
}

.note-btn:hover:not(:disabled) { background: var(--primary); color: white; }
.note-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.note-btn.btn-correct { background: var(--success); color: white; }
.note-btn.btn-highlight { border-color: var(--success); color: var(--success); }

.controls {
  display: flex;
  gap: 10px;
}

/* Summary */
.summary-title {
  font-size: 1.4rem;
  font-weight: 700;
  text-align: center;
}

.summary-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.summary-stat {
  background: var(--surface-2);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.summary-label {
  font-size: 0.7rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.summary-value {
  font-size: 1.4rem;
  font-weight: 700;
}

.note-breakdown {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.breakdown-row {
  display: grid;
  grid-template-columns: 36px 1fr 48px;
  align-items: center;
  gap: 10px;
}

.breakdown-note {
  font-weight: 600;
  font-size: 0.875rem;
}

.breakdown-bar-wrap {
  height: 7px;
  background: var(--surface-2);
  border-radius: 4px;
  overflow: hidden;
}

.breakdown-bar {
  height: 100%;
  background: var(--primary);
  border-radius: 4px;
  transition: width 0.5s ease;
}

.breakdown-count {
  font-size: 0.8rem;
  color: var(--text-muted);
  text-align: right;
}

/* Mobile */
@media (max-width: 400px) {
  .card { padding: 18px 14px; gap: 16px; }
  .note-buttons { gap: 4px; }
  .note-btn { padding: 12px 2px; font-size: 0.8rem; }
  .title { font-size: 1.3rem; }
  .summary-stats { grid-template-columns: 1fr; }
}
</style>
