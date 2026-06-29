<template>
  <div class="trainer-overlay" @click.self="$emit('close')">
    <div class="trainer-panel">

      <!-- Header -->
      <div class="trainer-header">
        <h2 class="trainer-title">{{ ui.title }}</h2>
        <button class="trainer-close" @click="$emit('close')">✕</button>
      </div>

      <!-- ── Grid: pick a note to record ── -->
      <template v-if="step === 'grid'">
        <p class="trainer-hint">{{ ui.gridHint }}</p>
        <div class="note-cells">
          <button
            v-for="(name, i) in noteNames"
            :key="i"
            class="note-cell"
            :class="{ done: counts[i] >= MIN_SAMPLES }"
            @click="selectNote(i)"
          >
            <span class="nc-name">{{ name }}</span>
            <span class="nc-badge" :class="{ 'nc-done': counts[i] >= MIN_SAMPLES }">
              {{ counts[i] >= MIN_SAMPLES ? '✓' : `${counts[i]}/${MIN_SAMPLES}` }}
            </span>
          </button>
        </div>

        <div class="trainer-actions">
          <button
            v-if="allReady"
            class="btn-primary"
            :disabled="training"
            @click="doTrain"
          >
            {{ training ? ui.training : ui.trainBtn }}
          </button>
          <button
            v-if="hasPersonal"
            class="btn-danger-sm"
            :disabled="training"
            @click="doReset"
          >{{ ui.reset }}</button>
        </div>
      </template>

      <!-- ── Record a single note ── -->
      <template v-else-if="step === 'record'">
        <div class="record-note-display">{{ noteNames[activeNote] }}</div>
        <p class="trainer-hint">{{ ui.sayNote.replace('{note}', noteNames[activeNote]) }}</p>
        <div class="record-count">{{ counts[activeNote] }} / {{ MIN_SAMPLES }}</div>

        <button
          class="record-btn"
          :class="{ recording: isRecording }"
          @mousedown.prevent="startRecord"
          @mouseup.prevent="stopRecord"
          @touchstart.prevent="startRecord"
          @touchend.prevent="stopRecord"
          @mouseleave="stopRecord"
        >
          <span v-if="isRecording">🔴 {{ ui.recording }}</span>
          <span v-else>🎤 {{ ui.holdToRecord }}</span>
        </button>

        <!-- Mic level bar -->
        <div class="record-meter-wrap">
          <div class="record-meter-bar" :style="{ width: (micLevel * 100).toFixed(0) + '%' }" />
        </div>

        <div class="trainer-actions">
          <button class="btn-secondary" @click="backToGrid">{{ ui.back }}</button>
          <button
            v-if="counts[activeNote] >= MIN_SAMPLES"
            class="btn-primary"
            @click="backToGrid"
          >{{ ui.nextNote }}</button>
        </div>
      </template>

      <!-- ── Done ── -->
      <template v-else-if="step === 'done'">
        <div class="done-icon">✅</div>
        <p class="done-msg">{{ ui.modelTrained }}</p>
        <p class="done-accuracy">{{ ui.accuracy.replace('{pct}', (displayAccuracy * 100).toFixed(0)) }}</p>
        <div class="trainer-actions">
          <button class="btn-primary" @click="$emit('close')">{{ ui.useModel }}</button>
          <button class="btn-secondary" @click="retrain">{{ ui.retrain }}</button>
        </div>
      </template>

    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'

const props = defineProps({
  lang:          { type: String,   default: 'fr' },
  counts:        { type: Array,    required: true },
  personalReady: { type: Boolean,  default: false },
  trainAccuracy: { type: Number,   default: 0 },
  collectSample: { type: Function, required: true },
  trainPersonal: { type: Function, required: true },
  resetPersonal: { type: Function, required: true },
})

const emit = defineEmits(['close', 'trained'])

// ── i18n ────────────────────────────────────────────────────────────────────

const STRINGS = {
  fr: {
    title:       'Entraîner votre voix',
    gridHint:    'Cliquez sur une note pour enregistrer des échantillons.',
    sayNote:     'Dites « {note} »',
    holdToRecord:'Maintenir pour enregistrer',
    recording:   'Enregistrement…',
    back:        '← Retour',
    nextNote:    'Note suivante →',
    trainBtn:    'Entraîner le modèle',
    training:    'Entraînement…',
    reset:       'Réinitialiser',
    modelTrained:'Modèle personnel entraîné !',
    accuracy:    'Précision : {pct} %',
    useModel:    'Utiliser ce modèle',
    retrain:     'Recommencer',
  },
  en: {
    title:       'Train your voice',
    gridHint:    'Click a note to record samples.',
    sayNote:     'Say "{note}"',
    holdToRecord:'Hold to record',
    recording:   'Recording…',
    back:        '← Back',
    nextNote:    'Next note →',
    trainBtn:    'Train model',
    training:    'Training…',
    reset:       'Reset',
    modelTrained:'Personal model trained!',
    accuracy:    'Accuracy: {pct}%',
    useModel:    'Use this model',
    retrain:     'Retrain',
  },
}
const ui = computed(() => STRINGS[props.lang] || STRINGS.en)

const NOTE_NAMES_FR = ['Do', 'Ré', 'Mi', 'Fa', 'Sol', 'La', 'Si']
const NOTE_NAMES_EN = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si']
const noteNames = computed(() => props.lang === 'fr' ? NOTE_NAMES_FR : NOTE_NAMES_EN)

// ── State ────────────────────────────────────────────────────────────────────

const MIN_SAMPLES   = 5
const step           = ref('grid')   // 'grid' | 'record' | 'done'
const activeNote     = ref(null)
const isRecording    = ref(false)
const micLevel       = ref(0)
const training       = ref(false)
const displayAccuracy = ref(0)       // accuracy shown on 'done' screen

const allReady    = computed(() => props.counts.every(c => c >= MIN_SAMPLES))
const hasPersonal = computed(() => props.personalReady || props.counts.some(c => c > 0))

// Advance to 'done' when training completes (personalReady flips while training was in progress)
watch(() => props.trainAccuracy, (acc) => {
  if (training.value && acc > 0) {
    training.value       = false
    displayAccuracy.value = acc
    step.value           = 'done'
  }
})

// ── Audio capture (push-to-record) ───────────────────────────────────────────

let audioCtx        = null
let processor       = null
let stream          = null
let recordedChunks  = []

async function startRecord() {
  if (isRecording.value) return
  recordedChunks = []

  try {
    stream   = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    audioCtx = new AudioContext({ sampleRate: 16000 })

    const source  = audioCtx.createMediaStreamSource(stream)
    processor     = audioCtx.createScriptProcessor(512, 1, 1)
    source.connect(processor)
    processor.connect(audioCtx.destination)

    processor.onaudioprocess = (ev) => {
      const pcm = ev.inputBuffer.getChannelData(0)
      recordedChunks.push(new Float32Array(pcm))
      let s = 0; for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i]
      micLevel.value = Math.min(Math.sqrt(s / pcm.length) * 6, 1)
    }
    isRecording.value = true
  } catch {}
}

async function stopRecord() {
  if (!isRecording.value) return
  isRecording.value = false
  micLevel.value    = 0

  processor?.disconnect(); processor = null
  stream?.getTracks().forEach(t => t.stop()); stream = null
  try { await audioCtx?.close() } catch {}; audioCtx = null

  // Concatenate chunks → send to worker
  const total = recordedChunks.reduce((s, a) => s + a.length, 0)
  if (total < 1600) { recordedChunks = []; return }   // < 100 ms — ignore

  const audio = new Float32Array(total)
  let offset  = 0
  for (const c of recordedChunks) { audio.set(c, offset); offset += c.length }
  recordedChunks = []

  props.collectSample(audio, activeNote.value)
}

// ── Navigation ───────────────────────────────────────────────────────────────

function selectNote(i) {
  activeNote.value = i
  step.value       = 'record'
}

function backToGrid() {
  stopRecord()
  step.value = 'grid'
}

async function doTrain() {
  training.value = true
  // Training runs in the worker (async); wait for 'trained' event via collectSample/trainPersonal
  // We wire up a one-shot listener via the parent's onTrained prop
  props.trainPersonal()
}

function doReset() {
  props.resetPersonal()
  step.value = 'grid'
}

function retrain() {
  step.value = 'grid'
}

onUnmounted(() => { stopRecord() })
</script>

<style scoped>
.trainer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: 1rem;
}

.trainer-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 1.5rem;
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
}

.trainer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.trainer-title {
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--text);
  margin: 0;
}

.trainer-close {
  background: none;
  border: none;
  font-size: 1.2rem;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
  transition: background 0.15s;
}
.trainer-close:hover { background: var(--surface-2); }

.trainer-hint {
  color: var(--text-muted);
  font-size: 0.88rem;
  text-align: center;
  margin: 0;
}

/* Note selection grid */
.note-cells {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 8px;
}

.note-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 4px;
  border-radius: 10px;
  border: 1.5px solid var(--border);
  background: var(--surface-2);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.note-cell:hover { border-color: var(--primary); }
.note-cell.done  { border-color: #22c55e; background: rgba(34,197,94,0.08); }

.nc-name {
  font-weight: 700;
  font-size: 1rem;
  color: var(--text);
}
.nc-badge {
  font-size: 0.72rem;
  color: var(--text-muted);
}
.nc-done { color: #22c55e; font-weight: 700; }

/* Record view */
.record-note-display {
  font-size: 4rem;
  font-weight: 900;
  text-align: center;
  color: var(--primary);
  line-height: 1;
}

.record-count {
  text-align: center;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-muted);
}

.record-btn {
  display: block;
  width: 100%;
  padding: 1.2rem;
  border-radius: 12px;
  border: 2px solid var(--primary);
  background: transparent;
  color: var(--primary);
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
  user-select: none;
  -webkit-user-select: none;
}
.record-btn:active,
.record-btn.recording {
  background: var(--primary);
  color: white;
}

.record-meter-wrap {
  height: 6px;
  background: var(--surface-2);
  border-radius: 3px;
  overflow: hidden;
}
.record-meter-bar {
  height: 100%;
  background: #22c55e;
  border-radius: 3px;
  transition: width 0.05s;
}

/* Done view */
.done-icon  { text-align: center; font-size: 3rem; }
.done-msg   { text-align: center; font-size: 1.1rem; font-weight: 700; color: var(--text); margin: 0; }
.done-accuracy { text-align: center; color: var(--text-muted); font-size: 0.9rem; margin: 0; }

/* Actions row */
.trainer-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}

.btn-primary {
  padding: 10px 20px;
  border-radius: 10px;
  border: none;
  background: var(--primary);
  color: white;
  font-weight: 600;
  cursor: pointer;
  font-size: 0.9rem;
  transition: opacity 0.15s;
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-secondary {
  padding: 10px 20px;
  border-radius: 10px;
  border: 1.5px solid var(--border);
  background: transparent;
  color: var(--text);
  font-weight: 600;
  cursor: pointer;
  font-size: 0.9rem;
}

.btn-danger-sm {
  padding: 8px 16px;
  border-radius: 10px;
  border: 1.5px solid #ef4444;
  background: transparent;
  color: #ef4444;
  font-weight: 600;
  cursor: pointer;
  font-size: 0.85rem;
}

@media (max-width: 480px) {
  .note-cells { grid-template-columns: repeat(4, 1fr); }
}
</style>
