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
        <!-- Game mode -->
        <div class="setting-group">
          <label class="setting-label">{{ t.gameMode }}</label>
          <div class="toggle-group">
            <button :class="['toggle-btn', { active: gameMode === 'read' }]" @click="gameMode = 'read'">
              📖 {{ t.gameModeRead }}
            </button>
            <button :class="['toggle-btn', { active: gameMode === 'ear' }]" @click="gameMode = 'ear'">
              🎵 {{ t.gameModeEar }}
            </button>
          </div>
        </div>

        <!-- Clef -->
        <div class="setting-group">
          <label class="setting-label">{{ t.clef }}</label>
          <div class="clef-picker">
            <!-- Sol -->
            <div class="clef-row">
              <span class="clef-type-label">{{ t.clefGroupSol }}</span>
              <div class="toggle-group">
                <button :class="['toggle-btn', { active: clef === 'sol2' }]" @click="selectClef('sol2')">
                  {{ t.clefLine }}2
                </button>
              </div>
            </div>
            <!-- Do -->
            <div class="clef-row">
              <span class="clef-type-label">{{ t.clefGroupDo }}</span>
              <div class="toggle-group">
                <button v-for="l in [1,2,3,4]" :key="l"
                  :class="['toggle-btn', { active: clef === 'do'+l }]"
                  @click="selectClef('do'+l)">
                  {{ t.clefLine }}{{ l }}
                </button>
              </div>
            </div>
            <!-- Fa -->
            <div class="clef-row">
              <span class="clef-type-label">{{ t.clefGroupFa }}</span>
              <div class="toggle-group">
                <button v-for="l in [3,4]" :key="l"
                  :class="['toggle-btn', { active: clef === 'fa'+l }]"
                  @click="selectClef('fa'+l)">
                  {{ t.clefLine }}{{ l }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Past notes slider -->
        <div class="setting-group">
          <label class="setting-label">
            {{ t.pastNotes }} — <span class="slider-value">{{ maxHistory }}</span>
          </label>
          <input type="range" min="0" max="5" v-model.number="maxHistory" class="slider" />
        </div>

        <!-- Note range -->
        <div class="setting-group">
          <label class="setting-label">
            {{ t.lowestNote }} — <span class="slider-value">{{ positionLabel(noteRangeMin, clef) }}</span>
          </label>
          <input type="range" :min="-4" :max="noteRangeMax - 1" v-model.number="noteRangeMin" class="slider" />
          <label class="setting-label" style="margin-top:6px">
            {{ t.highestNote }} — <span class="slider-value">{{ positionLabel(noteRangeMax, clef) }}</span>
          </label>
          <input type="range" :min="noteRangeMin + 1" :max="12" v-model.number="noteRangeMax" class="slider" />
        </div>

      </div>

      <!-- Staff preview -->
      <div class="preview-section">
        <span class="setting-label">{{ t.preview }}</span>
        <MusicStaff :note-history="previewHistory" :clef="clef" :max-history="maxHistory" />
      </div>

      <!-- Voice training -->
      <div v-if="voiceSupported" class="voice-train-row">
        <button class="btn-train-voice" @click="showTrainer = true">
          🎤 {{ t.trainVoice }}
        </button>
        <span v-if="personalReady" class="personal-badge">✓ {{ t.personalModel }}</span>
      </div>

      <button class="btn-primary btn-large" @click="startGame">{{ t.start }}</button>
    </div>

    <!-- Voice trainer modal -->
    <VoiceTrainer
      v-if="showTrainer"
      :lang="lang"
      :counts="collectCounts"
      :personal-ready="personalReady"
      :train-accuracy="trainAccuracy"
      :collect-sample="collectSample"
      :train-personal="trainPersonal"
      :reset-personal="resetPersonal"
      @close="showTrainer = false"
    />

    <!-- ── Game screen ─────────────────────────────────────────── -->
    <div v-else-if="screen === 'game'" class="card game-card">
      <!-- Header stats -->
      <div class="game-header">
        <div class="stat-pill error-pill">
          <span class="stat-label">{{ t.errors }}</span>
          <span class="stat-value">{{ errors }}</span>
        </div>
        <div class="stat-pill">
          <span class="stat-label">{{ t.time }}</span>
          <span class="stat-value">{{ formattedTime }}</span>
        </div>
        <div class="stat-pill success-pill">
          <span class="stat-label">{{ t.score }}</span>
          <span class="stat-value">{{ correct }}</span>
        </div>
      </div>

      <!-- Context badge -->
      <div class="context-badge">
        <span class="clef-tag">{{ t.clefs[clef] }}</span>
      </div>

      <!-- Staff -->
      <div class="staff-area">
        <MusicStaff
          :note-history="displayNoteHistory"
          :clef="clef"
          :feedback="feedback"
          :max-history="maxHistory"
          :clickable="gameMode === 'ear'"
          :cursor-pos="gameMode === 'ear' ? earCursorPos : null"
          @place="handleStaffPlace"
        />
        <div v-if="paused" class="pause-overlay">⏸ {{ t.paused }}</div>
      </div>

      <!-- ── DICTÉE mode: place the note on the staff ─────────────── -->
      <template v-if="gameMode === 'ear'">
        <!-- Arrow buttons + validate row -->
        <div class="ear-answer-row">
          <div class="ear-arrows">
            <button class="btn-arrow" :disabled="paused || earCursorPos >= noteRangeMax" @click="moveEarCursor(1)">▲</button>
            <button class="btn-arrow" :disabled="paused || earCursorPos <= noteRangeMin" @click="moveEarCursor(-1)">▼</button>
          </div>
          <span class="ear-hint">{{ t.clickStaff }}</span>
          <button
            class="btn-confirm"
            :disabled="paused || earCursorPos === null || !!feedback"
            @click="confirmEarCursor"
          >✓ {{ t.confirm }}</button>
        </div>

        <!-- Question presentation tabs -->
        <div class="input-tabs">
          <button :class="['input-tab', { active: earPresMode === 'text' }]" @click="setEarPresMode('text')">
            📝 {{ t.earPresText }}
          </button>
          <button :class="['input-tab', { active: earPresMode === 'audio' }]" @click="setEarPresMode('audio')">
            🔊 {{ t.earPresAudio }}
          </button>
          <button :class="['input-tab', { active: earPresMode === 'piano' }]" @click="setEarPresMode('piano')">
            🎹 {{ t.earPresPiano }}
          </button>
        </div>

        <!-- Text: show the note name -->
        <div v-if="earPresMode === 'text'" class="ear-pres-box">
          <span class="ear-note-name">
            {{ currentPos !== null ? t.notes[noteNameIndex(currentPos, clef)] : '—' }}
          </span>
        </div>

        <!-- Audio: replay button -->
        <div v-else-if="earPresMode === 'audio'" class="ear-pres-box">
          <button class="btn-replay-large" :disabled="paused" @click="playCurrentNote">
            🔊 {{ t.replay }}
          </button>
        </div>

        <!-- Piano: show keyboard with target key highlighted -->
        <div v-else-if="earPresMode === 'piano'" class="piano-kb-wrap">
          <div class="piano-kb">
            <div
              v-for="(note, idx) in t.notes"
              :key="idx"
              :class="['pk-white', 'pk-noop',
                       currentPos !== null && idx === noteNameIndex(currentPos, clef) ? 'pk-target' : '']"
            >
              <span class="pk-label">{{ note }}</span>
            </div>
            <div class="pk-black" style="left:10.2%"></div>
            <div class="pk-black" style="left:24.5%"></div>
            <div class="pk-black" style="left:52.9%"></div>
            <div class="pk-black" style="left:67.1%"></div>
            <div class="pk-black" style="left:81.4%"></div>
          </div>
        </div>
      </template>

      <!-- ── LECTURE mode: identify the displayed note ─────────────── -->
      <template v-else>
        <!-- Input mode tabs -->
        <div class="input-tabs">
          <button :class="['input-tab', { active: inputMode === 'buttons' }]" @click="setInputMode('buttons')">
            ⌨ {{ t.inputModeButtons }}
          </button>
          <button
            v-if="voiceSupported"
            :class="['input-tab', { active: inputMode === 'voice' }]"
            @click="setInputMode('voice')"
          >🎤 {{ t.inputModeVoice }}</button>
          <button
            v-if="pianoSupported"
            :class="['input-tab', { active: inputMode === 'pianoAudio' }]"
            @click="setInputMode('pianoAudio')"
          >🎙 {{ t.inputModePianoAudio }}</button>
          <button :class="['input-tab', { active: inputMode === 'pianoKeys' }]" @click="setInputMode('pianoKeys')">
            🎹 {{ t.inputModePianoKeys }}
          </button>
        </div>

        <!-- Buttons mode -->
        <div v-if="inputMode === 'buttons'" class="note-buttons">
          <button
            v-for="(note, idx) in t.notes"
            :key="idx"
            :class="['note-btn', answerClass(idx)]"
            :disabled="paused"
            @click="answer(idx)"
          >{{ note }}</button>
        </div>

        <!-- Voice mode -->
        <div v-else-if="inputMode === 'voice'" class="audio-mode-section">
          <div class="audio-row">
            <button
              :class="['btn-mic', { active: isListening }]"
              :title="isListening ? t.voiceOff : t.voiceOn"
              :disabled="paused || modelProgress < 100"
              @click="toggleVoice"
            >🎤</button>
            <div class="audio-feedback">
              <template v-if="modelProgress < 100">
                <span class="model-loading-label">{{ modelProgress }}%</span>
                <div class="model-bar-wrap">
                  <div class="model-bar" :style="{ width: modelProgress + '%' }" />
                </div>
              </template>
              <template v-else-if="lastHeard">
                <span class="heard-chip">🎤 {{ lastHeard }}</span>
              </template>
              <template v-else-if="rawTranscript">
                <span class="heard-chip muted">🔍 {{ rawTranscript }}</span>
              </template>
              <span v-else :class="['device-badge', deviceType]">
                {{ deviceType === 'kws' ? '⚡ KWS' : deviceType === 'webgpu' ? '⚡ GPU' : '🖥 CPU' }}
              </span>
            </div>
          </div>
          <div v-if="isListening" class="mic-meter-wrap">
            <div
              class="mic-meter-bar"
              :class="{ speaking: micLevel > thresholdFraction }"
              :style="{ width: (micLevel * 100).toFixed(1) + '%' }"
            />
            <div class="mic-meter-threshold" :style="{ left: (thresholdFraction * 100).toFixed(1) + '%' }" />
          </div>
          <div v-if="isListening" class="mic-threshold-row">
            <label class="setting-label">
              {{ t.micThreshold }} — <span class="slider-value">{{ micThreshold === 0 ? t.micOff : micThreshold + '%' }}</span>
            </label>
            <input type="range" min="0" max="90" step="5" v-model.number="micThreshold" class="slider" />
          </div>
        </div>

        <!-- Piano audio mode -->
        <div v-else-if="inputMode === 'pianoAudio'" class="audio-mode-section">
          <div class="audio-row">
            <button
              :class="['btn-mic', { active: pianoListening }]"
              :title="pianoListening ? t.pianoOff : t.pianoOn"
              :disabled="paused"
              @click="togglePiano"
            >🎹</button>
            <div class="audio-feedback">
              <template v-if="lastHeardHz">
                <span class="heard-chip">🎹 {{ lastHeardHz.toFixed(0) }} Hz</span>
              </template>
              <span v-else class="setting-label">{{ pianoListening ? t.pianoOff : t.pianoOn }}</span>
            </div>
          </div>
        </div>

        <!-- Piano keys mode -->
        <div v-else-if="inputMode === 'pianoKeys'" class="piano-kb-wrap">
          <div class="piano-kb">
            <div
              v-for="(note, idx) in t.notes"
              :key="idx"
              :class="['pk-white', answerClass(idx), { 'pk-disabled': paused }]"
              @click="!paused && answer(idx)"
            >
              <span class="pk-label">{{ note }}</span>
            </div>
            <div class="pk-black" style="left:10.2%"></div>
            <div class="pk-black" style="left:24.5%"></div>
            <div class="pk-black" style="left:52.9%"></div>
            <div class="pk-black" style="left:67.1%"></div>
            <div class="pk-black" style="left:81.4%"></div>
          </div>
        </div>
      </template>

      <!-- Game controls -->
      <div class="controls">
        <button class="btn-secondary" @click="togglePause">
          {{ paused ? t.resume : t.pause }}
        </button>
        <button class="btn-skip" :disabled="paused || !!feedback" @click="skipNote">{{ t.skip }}</button>
        <button class="btn-danger" @click="stopGame">{{ t.stop }}</button>
        <button class="btn-quit" @click="quitGame">{{ t.quit }}</button>
      </div>
    </div>

    <!-- ── Summary screen ──────────────────────────────────────── -->
    <div v-else-if="screen === 'summary'" class="card summary-card">
      <h2 class="summary-title">{{ t.summary }}</h2>

      <!-- Accuracy hero -->
      <div v-if="accuracy !== null" class="accuracy-hero">
        <span class="accuracy-value" :class="accuracy >= 80 ? 'correct-val' : accuracy >= 50 ? 'warn-val' : 'error-val'">
          {{ accuracy }}%
        </span>
        <span class="accuracy-label">{{ accuracy >= 90 ? '🏆' : accuracy >= 70 ? '👍' : accuracy >= 50 ? '💪' : '📖' }}</span>
      </div>

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
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import MusicStaff from "./components/MusicStaff.vue";
import VoiceTrainer from "./components/VoiceTrainer.vue";
import { useI18n } from "./i18n.js";
import { useVoiceInput } from "./composables/useVoiceInput.js";
import { usePitchInput } from "./composables/usePitchInput.js";

// --- Theme ---
const isDark = ref(true);
function toggleTheme() {
	isDark.value = !isDark.value;
	document.documentElement.classList.toggle("light", !isDark.value);
}

// --- i18n ---
const lang = ref("fr");
const t = computed(() => useI18n(lang.value));

// --- Settings ---
const clef = ref("sol2");
const maxHistory = ref(3);
const micThreshold = ref(0); // 0–90, used as confidence threshold / 100
const noteRangeMin = ref(-4);
const noteRangeMax = ref(12);

function selectClef(c) {
	clef.value = c;
}

// Note names index (0=Do, 1=Ré, 2=Mi, 3=Fa, 4=Sol, 5=La, 6=Si)
// Offset = note name index at staff position 0 (bottom line) for each clef.
// Derived from: which note sits on the clef's reference line, then count down.
const CLEF_OFFSETS = {
	sol2: 2,
	do1: 0,
	do2: 5,
	do3: 3,
	do4: 1,
	fa3: 6,
	fa4: 4,
};
function clefOffset(clefType) {
	return CLEF_OFFSETS[clefType] ?? 2;
}

const MIN_POS = -4;
const MAX_POS = 12;

// MIDI note number at staff position 0 for each clef
const CLEF_BASE_MIDI = {
	sol2: 64, // E4
	do1: 60, // C4
	do2: 57, // A3
	do3: 53, // F3
	do4: 50, // D3
	fa3: 47, // B2
	fa4: 43, // G2
};
// Semitone offset from C for each diatonic note (Do Ré Mi Fa Sol La Si)
const NOTE_CHROMATIC = [0, 2, 4, 5, 7, 9, 11];

function positionToMidi(pos, clefType) {
	const baseIdx = clefOffset(clefType);
	const baseMidi = CLEF_BASE_MIDI[clefType] ?? 64;
	const steps = baseIdx + pos;
	const noteIdx = ((steps % 7) + 7) % 7;
	const octave = Math.floor(steps / 7);
	return baseMidi - NOTE_CHROMATIC[baseIdx] + NOTE_CHROMATIC[noteIdx] + octave * 12;
}

function playNote(midi) {
	const ctx = new AudioContext();
	const freq = 440 * Math.pow(2, (midi - 69) / 12);
	const now = ctx.currentTime;
	// Piano timbre: fundamental + harmonics with exponential decay
	[1, 2, 3, 4, 6].forEach((h, i) => {
		const amp = [0.50, 0.25, 0.12, 0.06, 0.03][i];
		const osc = ctx.createOscillator();
		const g = ctx.createGain();
		osc.frequency.value = freq * h;
		osc.type = "sine";
		g.gain.setValueAtTime(0, now);
		g.gain.linearRampToValueAtTime(amp, now + 0.006);
		g.gain.exponentialRampToValueAtTime(amp * 0.15, now + 0.5);
		g.gain.exponentialRampToValueAtTime(0.0001, now + 2.0);
		osc.connect(g);
		g.connect(ctx.destination);
		osc.start(now);
		osc.stop(now + 2.1);
	});
	setTimeout(() => ctx.close().catch(() => {}), 2500);
}

function playCurrentNote() {
	if (currentPos.value === null) return;
	playNote(positionToMidi(currentPos.value, clef.value));
}

function noteNameIndex(position, clefType) {
	const offset = clefOffset(clefType);
	return (((offset + position) % 7) + 7) % 7;
}

// Returns a human-readable label for a staff position, e.g. "Mi L1" or "Do ▼1"
function positionLabel(pos, clefType) {
	const name = t.value.notes[noteNameIndex(pos, clefType)];
	if (pos < 0) return `${name} ▼${Math.ceil(-pos / 2)}`;
	if (pos > 8) return `${name} ▲${Math.ceil((pos - 8) / 2)}`;
	if (pos % 2 === 0) return `${name} L${pos / 2 + 1}`;
	return `${name} E${Math.ceil(pos / 2)}`;
}

// --- Game mode ---
const gameMode = ref("read"); // 'read' | 'ear'
const earPresMode = ref("audio"); // 'text' | 'audio' | 'piano'
const earCursorPos = ref(null); // staff position of the keyboard/arrow cursor

function setEarPresMode(mode) {
	earPresMode.value = mode;
	if (mode === "audio" && currentPos.value !== null && !paused.value) {
		setTimeout(playCurrentNote, 50);
	}
}

function moveEarCursor(dir) {
	if (earCursorPos.value === null) return;
	earCursorPos.value = Math.max(
		noteRangeMin.value,
		Math.min(noteRangeMax.value, earCursorPos.value + dir),
	);
}

function confirmEarCursor() {
	if (earCursorPos.value !== null && !paused.value && !feedback.value) {
		handleStaffPlace(earCursorPos.value);
	}
}

function handleGlobalKeydown(e) {
	if (screen.value !== "game" || gameMode.value !== "ear") return;
	if (paused.value || feedback.value) return;
	if (e.key === "ArrowUp") {
		e.preventDefault();
		moveEarCursor(1);
	} else if (e.key === "ArrowDown") {
		e.preventDefault();
		moveEarCursor(-1);
	} else if (e.key === "Enter" || e.key === " ") {
		e.preventDefault();
		confirmEarCursor();
	}
}

// --- Game state ---
const screen = ref("setup");
const noteHistory = ref([]); // [{id, pos, result}], last item is always the current note
let noteIdCounter = 0;
const feedback = ref(null);
const correct = ref(0);
const errors = ref(0);
const paused = ref(false);
const noteStats = ref(
	Array.from({ length: 7 }, () => ({ correct: 0, wrong: 0 })),
);
const wrongPressedIdx = ref(null);

let timerInterval = null;
const elapsedMs = ref(0);
let feedbackTimeout = null;

const currentPos = computed(() => noteHistory.value.at(-1)?.pos ?? null);

// In ear mode, hide the current (unanswered) note; reveal it during feedback
const displayNoteHistory = computed(() => {
	if (gameMode.value === "ear" && !feedback.value) {
		return noteHistory.value.slice(0, -1);
	}
	return noteHistory.value;
});

// Clicking the staff in ear mode: translate position to note name index
function handleStaffPlace(pos) {
	answer(noteNameIndex(pos, clef.value));
}

const previewHistory = computed(() => [
	{ id: -2, pos: noteRangeMin.value, result: null, color: "#6366f1" },
	{ id: -1, pos: noteRangeMax.value, result: null, color: "#6366f1" },
]);

// --- Computed ---
const formattedTime = computed(() => {
	const s = Math.floor(elapsedMs.value / 1000);
	const m = Math.floor(s / 60);
	return `${m}:${String(s % 60).padStart(2, "0")}`;
});

const formattedTotalTime = computed(() => formattedTime.value);

const avgTimePerNote = computed(() => {
	const total = correct.value + errors.value;
	if (total === 0) return "—";
	return (elapsedMs.value / total / 1000).toFixed(1) + " " + t.value.seconds;
});

function breakdownBarWidth(idx) {
	const s = noteStats.value[idx];
	if (!s) return 0;
	const total = s.correct + s.wrong;
	return total === 0 ? 0 : Math.round((s.correct / total) * 100);
}

// --- Game logic ---
function pickNextNote() {
	const minP = noteRangeMin.value;
	const maxP = noteRangeMax.value;
	let pos;
	do {
		pos = Math.floor(Math.random() * (maxP - minP + 1)) + minP;
	} while (pos === currentPos.value && maxP > minP);
	const next = [
		...noteHistory.value,
		{ id: noteIdCounter++, pos, result: null },
	];
	noteHistory.value = next.slice(-6); // keep enough for the max slider value (5 past + 1 current)
	if (gameMode.value === "ear") {
		// Place cursor in the middle of the allowed range for each new note
		earCursorPos.value = Math.round((noteRangeMin.value + noteRangeMax.value) / 2);
		if (earPresMode.value === "audio") setTimeout(playCurrentNote, 80);
	}
}

function startGame() {
	screen.value = "game";
	correct.value = 0;
	errors.value = 0;
	elapsedMs.value = 0;
	paused.value = false;
	noteStats.value = Array.from({ length: 7 }, () => ({ correct: 0, wrong: 0 }));
	feedback.value = null;
	noteHistory.value = [];
	noteIdCounter = 0;
	pickNextNote();
	startTimer();
}

function startTimer() {
	let lastTick = performance.now();
	timerInterval = setInterval(() => {
		const now = performance.now();
		if (!paused.value) elapsedMs.value += now - lastTick;
		lastTick = now;
	}, 100);
}

function stopTimer() {
	if (timerInterval) {
		clearInterval(timerInterval);
		timerInterval = null;
	}
}

function answer(noteIdx) {
	if (paused.value || feedback.value) return;
	if (currentPos.value === null) return;
	const expected = noteNameIndex(currentPos.value, clef.value);
	const isCorrect = noteIdx === expected;

	if (isCorrect) {
		correct.value++;
		noteStats.value[expected].correct++;
		feedback.value = "correct";
		const h = [...noteHistory.value];
		h[h.length - 1] = { ...h[h.length - 1], result: "correct" };
		noteHistory.value = h;
	} else {
		errors.value++;
		noteStats.value[expected].wrong++;
		feedback.value = "wrong";
		wrongPressedIdx.value = noteIdx;
	}

	if (feedbackTimeout) clearTimeout(feedbackTimeout);
	const feedbackMs = gameMode.value === "ear" ? 800 : 400;
	feedbackTimeout = setTimeout(() => {
		feedback.value = null;
		wrongPressedIdx.value = null;
		if (isCorrect) pickNextNote();
	}, feedbackMs);
}

function answerClass(idx) {
	if (!feedback.value) return "";
	const expected = noteNameIndex(currentPos.value, clef.value);
	if (feedback.value === "correct" && idx === expected) return "btn-correct";
	if (feedback.value === "wrong" && idx === expected) return "btn-highlight";
	if (feedback.value === "wrong" && idx === wrongPressedIdx.value)
		return "btn-wrong";
	return "";
}

const accuracy = computed(() => {
	const total = correct.value + errors.value;
	return total === 0 ? null : Math.round((correct.value / total) * 100);
});

function skipNote() {
	if (feedbackTimeout) clearTimeout(feedbackTimeout);
	feedback.value = null;
	pickNextNote();
}

function togglePause() {
	paused.value = !paused.value;
}

function quitGame() {
	stopTimer();
	if (feedbackTimeout) clearTimeout(feedbackTimeout);
	if (isListening.value) toggleVoice();
	if (pianoListening.value) togglePiano();
	feedback.value = null;
	noteHistory.value = [];
	screen.value = "setup";
}

function stopGame() {
	stopTimer();
	if (feedbackTimeout) clearTimeout(feedbackTimeout);
	if (isListening.value) toggleVoice();
	if (pianoListening.value) togglePiano();
	screen.value = "summary";
}

function playAgain() {
	screen.value = "setup";
	noteHistory.value = [];
}

// Fraction of the meter bar where the current VAD threshold sits (for the marker line)
// Mirrors: energyThreshold = 0.10 - sliderPct * 0.088, then ×4 to match the meter scaling
const thresholdFraction = computed(() => {
	const sliderPct = micThreshold.value / 100;
	const energy = 0.1 - sliderPct * 0.088;
	return Math.min(energy * 4, 1);
});

// --- Voice input + personal model ---
const {
	isSupported: voiceSupported,
	isListening,
	lastHeard,
	rawTranscript,
	modelProgress,
	deviceType,
	micLevel,
	toggle: toggleVoice,
	collectCounts,
	personalReady,
	trainAccuracy,
	collectSample,
	trainPersonal,
	resetPersonal,
} = useVoiceInput({ lang, onNote: answer, micThreshold });

// --- Piano pitch detection ---
const lastHeardHz = ref(0);
const {
	isSupported: pianoSupported,
	isListening: pianoListening,
	toggle: togglePiano,
} = usePitchInput({ onNote: answer, micThreshold, lastHeardHz });

// --- Input mode ---
const inputMode = ref("buttons"); // 'buttons' | 'voice' | 'pianoAudio' | 'pianoKeys'

function setInputMode(mode) {
	// Stop any active audio before switching
	if (isListening.value) toggleVoice();
	if (pianoListening.value) togglePiano();
	inputMode.value = mode;
	// Auto-start audio for audio modes (only when game is running)
	if (!paused.value && screen.value === "game") {
		if (mode === "voice") toggleVoice();
		if (mode === "pianoAudio") togglePiano();
	}
}

const showTrainer = ref(false);

onMounted(() => window.addEventListener("keydown", handleGlobalKeydown));
onBeforeUnmount(() => {
	stopTimer();
	if (feedbackTimeout) clearTimeout(feedbackTimeout);
	window.removeEventListener("keydown", handleGlobalKeydown);
});
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
  padding: 28px 24px;
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.25);
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
  padding: 10px 16px;
  font-weight: 600;
  flex: 1;
  border: 1px solid transparent;
}
.btn-secondary:hover { background: var(--border); border-color: var(--border); }

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
.device-badge.kws    { color: #22c55e; border: 1px solid #22c55e; }

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

/* legacy, no longer used in game screen — kept for safety */
.voice-heard { display: none; }

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
  justify-content: space-between;
  gap: 8px;
}

.stat-pill {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  background: var(--surface-2);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  border: 1px solid transparent;
}

.error-pill  { border-color: color-mix(in srgb, var(--error) 30%, transparent); }
.success-pill { border-color: color-mix(in srgb, var(--success) 30%, transparent); }

.stat-label {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text-muted);
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1;
}

.error-pill  .stat-value { color: var(--error); }
.success-pill .stat-value { color: var(--success); }

.error-val { color: var(--error); }
.correct-val { color: var(--success); }
.warn-val { color: #f59e0b; }

.context-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: -6px;
}

/* Ear mode answer row (arrows + hint) */
.ear-answer-row {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: center;
  margin-top: -4px;
}

.ear-hint {
  flex: 1;
  text-align: center;
  font-size: 0.72rem;
  color: var(--text-muted);
  letter-spacing: 0.01em;
}

.ear-arrows {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.btn-arrow {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.12s;
}
.btn-arrow:hover:not(:disabled) { background: var(--primary); color: white; border-color: var(--primary); }
.btn-arrow:disabled { opacity: 0.3; cursor: not-allowed; }

.btn-confirm {
  padding: 0 14px;
  height: 36px;
  border-radius: var(--radius-sm);
  background: var(--primary);
  color: white;
  border: none;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s;
}
.btn-confirm:hover:not(:disabled) { background: var(--primary-hover); }
.btn-confirm:disabled { opacity: 0.35; cursor: not-allowed; }

/* Ear presentation content boxes */
.ear-pres-box {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px 0 10px;
  background: var(--surface-2);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  min-height: 72px;
}

.ear-note-name {
  font-size: 2.8rem;
  font-weight: 800;
  color: var(--primary);
  letter-spacing: 0.02em;
}

.btn-replay-large {
  padding: 12px 28px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--primary) 14%, transparent);
  border: 1.5px solid color-mix(in srgb, var(--primary) 40%, transparent);
  color: var(--primary);
  font-size: 1rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-replay-large:hover:not(:disabled) { background: var(--primary); color: white; }
.btn-replay-large:disabled { opacity: 0.4; cursor: not-allowed; }

/* Piano target key (ear / piano presentation) */
.pk-noop { cursor: default !important; }
.pk-noop:hover { background: #efefef !important; box-shadow: none !important; }
.pk-target { background: color-mix(in srgb, var(--primary) 30%, #efefef) !important; border-color: var(--primary) !important; }
.pk-target .pk-label { color: var(--primary) !important; }

.clef-tag {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--surface-2);
  border-radius: 99px;
  padding: 3px 12px;
  letter-spacing: 0.03em;
}

.staff-area {
  position: relative;
}

.pause-overlay {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--bg) 75%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--text-muted);
  backdrop-filter: blur(3px);
  letter-spacing: 0.04em;
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
  padding: 18px 4px;
  font-size: 0.95rem;
  font-weight: 700;
  border: 2px solid transparent;
  letter-spacing: 0.01em;
}

.note-btn:hover:not(:disabled) {
  background: var(--primary);
  border-color: var(--primary);
  color: white;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--primary) 35%, transparent);
}
.note-btn:active:not(:disabled) { transform: translateY(0); box-shadow: none; }
.note-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.note-btn.btn-correct { background: var(--success); border-color: var(--success); color: white; }
.note-btn.btn-highlight { border-color: var(--success); color: var(--success); }
.note-btn.btn-wrong { background: var(--error); border-color: var(--error); color: white; }

.controls {
  display: flex;
  gap: 8px;
}

/* Input mode tab bar */
.input-tabs {
  display: flex;
  gap: 3px;
  background: var(--surface-2);
  border-radius: 10px;
  padding: 3px;
}

.input-tab {
  flex: 1;
  padding: 8px 4px;
  border-radius: 8px;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-muted);
  background: transparent;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 0.15s, color 0.15s;
}

.input-tab.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
}

.input-tab:hover:not(.active) {
  color: var(--text);
}

/* Audio mode sections (voice / piano-audio) */
.audio-mode-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: var(--surface-2);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}

.audio-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.audio-feedback {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

/* Piano keyboard */
.piano-kb-wrap {
  background: #25253a;
  border-radius: 10px;
  padding: 8px 8px 0;
}

.piano-kb {
  position: relative;
  display: flex;
  height: 90px;
}

.pk-white {
  flex: 1;
  background: #efefef;
  border: 1px solid #999;
  border-top: 3px solid #888;
  border-left: none;
  border-radius: 0 0 6px 6px;
  cursor: pointer;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 5px;
  position: relative;
  z-index: 1;
  transition: background 0.08s;
  user-select: none;
  -webkit-user-select: none;
}

.pk-white:first-child {
  border-left: 1px solid #999;
  border-radius: 0 0 6px 6px;
}

.pk-white:hover:not(.pk-disabled) {
  background: #dde0ff;
}

.pk-white:active:not(.pk-disabled) {
  background: #c8ccff;
}

.pk-white.pk-disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.pk-label {
  font-size: 0.62rem;
  font-weight: 700;
  color: #555;
  pointer-events: none;
}

.pk-black {
  position: absolute;
  top: 0;
  width: 8.5%;
  height: 58%;
  background: linear-gradient(to bottom, #333, #111);
  border-radius: 0 0 4px 4px;
  z-index: 2;
  pointer-events: none;
  box-shadow: 2px 4px 6px rgba(0, 0, 0, 0.5);
}

/* Piano key feedback states */
.pk-white.btn-correct { background: var(--success) !important; }
.pk-white.btn-correct .pk-label { color: white; }
.pk-white.btn-highlight {
  background: color-mix(in srgb, var(--success) 25%, #efefef) !important;
  border-color: var(--success);
}
.pk-white.btn-wrong { background: var(--error) !important; }
.pk-white.btn-wrong .pk-label { color: white; }

.heard-chip {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--primary) 30%, transparent);
  border-radius: 99px;
  padding: 3px 10px;
}
.heard-chip.muted { color: var(--text-muted); background: transparent; border-color: var(--border); }

/* Preview section (setup) */
.preview-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Summary */
.summary-title {
  font-size: 1.4rem;
  font-weight: 700;
  text-align: center;
}

.accuracy-hero {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 8px 0 4px;
}

.accuracy-value {
  font-size: 3rem;
  font-weight: 800;
  line-height: 1;
}

.accuracy-label {
  font-size: 2rem;
  line-height: 1;
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

/* Clef grouped picker */
.clef-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.clef-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.clef-type-label {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-muted);
  width: 26px;
  flex-shrink: 0;
}

/* Voice train row */
.voice-train-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
}

.btn-train-voice {
  padding: 9px 18px;
  border-radius: 10px;
  border: 1.5px solid var(--primary);
  background: transparent;
  color: var(--primary);
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.btn-train-voice:hover { background: var(--primary); color: white; }

.personal-badge {
  font-size: 0.8rem;
  font-weight: 600;
  color: #22c55e;
  border: 1px solid #22c55e;
  border-radius: 8px;
  padding: 4px 10px;
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
