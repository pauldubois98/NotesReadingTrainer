<template>
  <div class="app">
    <!-- Setup screen -->
    <div v-if="screen === 'setup'" class="card setup-card">
      <h1 class="title">{{ t.title }}</h1>
      <p class="subtitle">{{ t.subtitle }}</p>

      <div class="settings">
        <!-- Language -->
        <div class="setting-group">
          <label class="setting-label">{{ t.language }}</label>
          <div class="toggle-group">
            <button
              v-for="l in ['fr', 'en']"
              :key="l"
              :class="['toggle-btn', { active: lang === l }]"
              @click="lang = l"
            >{{ l.toUpperCase() }}</button>
          </div>
        </div>

        <!-- Clef -->
        <div class="setting-group">
          <label class="setting-label">{{ t.clef }}</label>
          <div class="toggle-group">
            <button
              :class="['toggle-btn', { active: clef === 'sol' }]"
              @click="clef = 'sol'"
            >{{ t.clefSol }}</button>
            <button
              :class="['toggle-btn', { active: clef === 'do' }]"
              @click="clef = 'do'"
            >{{ t.clefDo }}</button>
            <button
              :class="['toggle-btn', { active: clef === 'fa' }]"
              @click="clef = 'fa'"
            >{{ t.clefFa }}</button>
          </div>
        </div>
      </div>

      <!-- Staff preview -->
      <MusicStaff :note-position="previewPosition" :clef="clef" />

      <button class="btn-primary btn-large" @click="startGame">{{ t.start }}</button>
    </div>

    <!-- Game screen -->
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

      <!-- Staff -->
      <div class="staff-area">
        <MusicStaff :note-position="currentPosition" :clef="clef" :feedback="feedback" />
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

      <!-- Controls -->
      <div class="controls">
        <button class="btn-secondary" @click="togglePause">
          {{ paused ? t.resume : t.pause }}
        </button>
        <button class="btn-danger" @click="stopGame">{{ t.stop }}</button>
      </div>
    </div>

    <!-- Summary screen -->
    <div v-else-if="screen === 'summary'" class="card summary-card">
      <h2 class="summary-title">{{ t.summary }}</h2>

      <div class="summary-stats">
        <div class="summary-stat">
          <span class="summary-icon">🎵</span>
          <span class="summary-label">{{ t.totalNotes }}</span>
          <span class="summary-value">{{ correct + errors }}</span>
        </div>
        <div class="summary-stat">
          <span class="summary-icon">✓</span>
          <span class="summary-label">{{ t.score }}</span>
          <span class="summary-value correct-val">{{ correct }}</span>
        </div>
        <div class="summary-stat">
          <span class="summary-icon">✗</span>
          <span class="summary-label">{{ t.errors }}</span>
          <span class="summary-value error-val">{{ errors }}</span>
        </div>
        <div class="summary-stat">
          <span class="summary-icon">⏱</span>
          <span class="summary-label">{{ t.time }}</span>
          <span class="summary-value">{{ formattedTotalTime }}</span>
        </div>
        <div class="summary-stat">
          <span class="summary-icon">⚡</span>
          <span class="summary-label">{{ t.avgTime }}</span>
          <span class="summary-value">{{ avgTimePerNote }}</span>
        </div>
      </div>

      <!-- Per-note breakdown -->
      <div class="note-breakdown">
        <div v-for="(note, idx) in t.notes" :key="idx" class="breakdown-row">
          <span class="breakdown-note">{{ note }}</span>
          <div class="breakdown-bar-wrap">
            <div
              class="breakdown-bar"
              :style="{ width: breakdownBarWidth(idx) + '%' }"
            />
          </div>
          <span class="breakdown-count">{{ noteStats[idx]?.correct ?? 0 }}/{{ (noteStats[idx]?.correct ?? 0) + (noteStats[idx]?.wrong ?? 0) }}</span>
        </div>
      </div>

      <div class="summary-actions">
        <button class="btn-primary btn-large" @click="playAgain">{{ t.playAgain }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import MusicStaff from './components/MusicStaff.vue'
import { useI18n } from './i18n.js'

// --- i18n ---
const lang = ref('fr')
const t = computed(() => useI18n(lang.value))

// --- Settings ---
const clef = ref('sol')

// Note names index (0=Do, 1=Re, 2=Mi, 3=Fa, 4=Sol, 5=La, 6=Si)
// For clef de Sol: position 0 (bottom line) = Mi (index 2)
// For clef de Do (alto): position 0 (bottom line) = Fa (index 3)
// For clef de Fa: position 0 (bottom line) = Sol (index 4)
function clefOffset(clefType) {
  if (clefType === 'sol') return 2
  if (clefType === 'do') return 3
  return 4 // fa
}

// Staff positions: 0=line1(bottom) .. 8=line5(top), +ledger lines
// We use positions from -4 (2 ledger lines below) to 12 (2 ledger lines above)
const MIN_POS = -4
const MAX_POS = 12

function noteNameIndex(position, clefType) {
  const offset = clefOffset(clefType)
  return ((offset + position) % 7 + 7) % 7
}

// --- Game state ---
const screen = ref('setup')
const currentPosition = ref(null)
const feedback = ref(null)
const correct = ref(0)
const errors = ref(0)
const paused = ref(false)

// Per-note stats: { correct, wrong } indexed by note name index (0-6)
const noteStats = ref(Array.from({ length: 7 }, () => ({ correct: 0, wrong: 0 })))

// Timer
let timerInterval = null
const elapsedMs = ref(0)
let noteStartMs = 0

// Preview for setup screen
const previewPosition = ref(4) // middle of staff

// Track last feedback timeout
let feedbackTimeout = null

// --- Computed ---
const formattedTime = computed(() => {
  const s = Math.floor(elapsedMs.value / 1000)
  const m = Math.floor(s / 60)
  const ss = String(s % 60).padStart(2, '0')
  return `${m}:${ss}`
})

const formattedTotalTime = computed(() => {
  const s = Math.floor(elapsedMs.value / 1000)
  const m = Math.floor(s / 60)
  const ss = String(s % 60).padStart(2, '0')
  return `${m}:${ss}`
})

const avgTimePerNote = computed(() => {
  const total = correct.value + errors.value
  if (total === 0) return '—'
  const avg = elapsedMs.value / total / 1000
  return avg.toFixed(1) + ' ' + t.value.seconds
})

function breakdownBarWidth(idx) {
  const stat = noteStats.value[idx]
  if (!stat) return 0
  const total = stat.correct + stat.wrong
  if (total === 0) return 0
  return Math.round((stat.correct / total) * 100)
}

// --- Game logic ---
function pickNextNote() {
  // Pick a random position, avoid repeating same position
  let pos
  do {
    pos = Math.floor(Math.random() * (MAX_POS - MIN_POS + 1)) + MIN_POS
  } while (pos === currentPosition.value)
  currentPosition.value = pos
  noteStartMs = performance.now()
}

function startGame() {
  screen.value = 'game'
  correct.value = 0
  errors.value = 0
  elapsedMs.value = 0
  paused.value = false
  noteStats.value = Array.from({ length: 7 }, () => ({ correct: 0, wrong: 0 }))
  feedback.value = null
  pickNextNote()
  startTimer()
}

function startTimer() {
  let lastTick = performance.now()
  timerInterval = setInterval(() => {
    if (!paused.value) {
      const now = performance.now()
      elapsedMs.value += now - lastTick
    }
    const now = performance.now()
    lastTick = now
  }, 100)
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = null
  }
}

function answer(noteIdx) {
  if (paused.value || feedback.value) return
  const expected = noteNameIndex(currentPosition.value, clef.value)
  const isCorrect = noteIdx === expected

  if (isCorrect) {
    correct.value++
    noteStats.value[expected].correct++
    feedback.value = 'correct'
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
  const expected = noteNameIndex(currentPosition.value, clef.value)
  if (feedback.value === 'correct' && idx === expected) return 'btn-correct'
  if (feedback.value === 'wrong' && idx === expected) return 'btn-highlight'
  return ''
}

function togglePause() {
  paused.value = !paused.value
}

function stopGame() {
  stopTimer()
  if (feedbackTimeout) clearTimeout(feedbackTimeout)
  screen.value = 'summary'
}

function playAgain() {
  screen.value = 'setup'
  currentPosition.value = null
}

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
  gap: 24px;
}

/* Setup */
.title {
  font-size: 1.6rem;
  font-weight: 700;
  text-align: center;
  color: var(--text);
}

.subtitle {
  color: var(--text-muted);
  text-align: center;
  font-size: 0.9rem;
}

.settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.setting-label {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.toggle-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.toggle-btn {
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 0.875rem;
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

.btn-primary:hover {
  background: var(--primary-hover);
}

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

.btn-secondary:hover {
  background: var(--border);
}

.btn-danger {
  background: transparent;
  color: var(--error);
  border-radius: var(--radius-sm);
  padding: 10px 20px;
  font-weight: 500;
  border: 1px solid var(--error);
  flex: 1;
}

.btn-danger:hover {
  background: var(--error);
  color: white;
}

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

.note-btn:hover:not(:disabled) {
  background: var(--primary);
  color: white;
}

.note-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.note-btn.btn-correct {
  background: var(--success);
  color: white;
}

.note-btn.btn-highlight {
  border-color: var(--success);
  color: var(--success);
}

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
  gap: 12px;
}

.summary-stat {
  background: var(--surface-2);
  border-radius: var(--radius-sm);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.summary-icon {
  font-size: 1.2rem;
}

.summary-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.summary-value {
  font-size: 1.5rem;
  font-weight: 700;
}

.note-breakdown {
  display: flex;
  flex-direction: column;
  gap: 8px;
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
  height: 8px;
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

.summary-actions {
  margin-top: 4px;
}

/* Mobile */
@media (max-width: 400px) {
  .card {
    padding: 20px 16px;
    gap: 18px;
  }

  .note-buttons {
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
  }

  .note-btn {
    padding: 12px 2px;
    font-size: 0.8rem;
  }

  .title {
    font-size: 1.3rem;
  }

  .summary-stats {
    grid-template-columns: 1fr;
  }
}
</style>
