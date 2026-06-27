<template>
  <div class="staff-wrapper">
    <svg :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" class="staff-svg" role="img" aria-label="Music staff">

      <!-- Staff lines — run from x=4 through the clef and across the full width -->
      <line
        v-for="i in 5"
        :key="i"
        :x1="4"
        :y1="lineY(i)"
        :x2="WIDTH - 20"
        :y2="lineY(i)"
        class="staff-line"
        stroke-width="1.5"
      />

      <!-- ── Treble clef (Sol) ────────────────────────────────── -->
      <!-- G curl is on line 2. The Unicode glyph baseline ≈ G line. -->
      <text
        v-if="clef === 'sol'"
        :x="36"
        :y="positionToY(2) + 8"
        class="clef-symbol clef-sol"
        text-anchor="middle"
        dominant-baseline="alphabetic"
      >𝄞</text>

      <!-- ── Bass clef (Fa) ──────────────────────────────────── -->
      <!-- F is on line 4 (pos 6). Starting dot + upward curved stroke + 2 reference dots. -->
      <g v-else-if="clef === 'fa'">
        <!-- Starting filled dot at F line -->
        <circle :cx="13" :cy="positionToY(6)" r="5.5" class="clef-shape" />
        <!-- Curved hook stroke arcing from F line upward then back down -->
        <path
          :d="bassClefPath"
          fill="none" class="clef-shape" stroke-width="3.5" stroke-linecap="round"
        />
        <!-- Upper reference dot: space between lines 4 and 5 (pos 7) -->
        <circle :cx="44" :cy="positionToY(7)" r="3" class="clef-shape" />
        <!-- Lower reference dot: space between lines 3 and 4 (pos 5) -->
        <circle :cx="44" :cy="positionToY(5)" r="3" class="clef-shape" />
      </g>

      <!-- ── Alto C clef (Do) ────────────────────────────────── -->
      <!-- C (middle C context) is on line 3 (pos 4).              -->
      <!-- Shape: thick left bar + two arms converging on C line + right bar -->
      <g v-else>
        <!-- Left thick vertical bar spanning lines 1–5 -->
        <rect
          :x="4" :y="positionToY(8) - 2"
          width="7"
          :height="positionToY(0) - positionToY(8) + 4"
          rx="2" class="clef-shape"
        />
        <!-- Upper arm: from top of staff (line 5) down to C line (line 3) -->
        <line
          :x1="11" :y1="positionToY(8)"
          :x2="37" :y2="positionToY(4)"
          class="clef-shape" stroke-width="4.5" stroke-linecap="round"
        />
        <!-- Lower arm: from bottom of staff (line 1) up to C line -->
        <line
          :x1="11" :y1="positionToY(0)"
          :x2="37" :y2="positionToY(4)"
          class="clef-shape" stroke-width="4.5" stroke-linecap="round"
        />
        <!-- Right small bar: from one space above C to one space below -->
        <rect
          :x="35" :y="positionToY(6)"
          width="5"
          :height="positionToY(2) - positionToY(6)"
          rx="2" class="clef-shape"
        />
      </g>

      <!-- Ledger lines above staff -->
      <template v-if="notePosition > 8">
        <line
          v-for="pos in ledgerPositionsAbove"
          :key="`above-${pos}`"
          :x1="NOTE_X - NOTE_RX - 6"
          :y1="positionToY(pos)"
          :x2="NOTE_X + NOTE_RX + 6"
          :y2="positionToY(pos)"
          class="staff-line"
          stroke-width="1.5"
        />
      </template>

      <!-- Ledger lines below staff -->
      <template v-if="notePosition < 0">
        <line
          v-for="pos in ledgerPositionsBelow"
          :key="`below-${pos}`"
          :x1="NOTE_X - NOTE_RX - 6"
          :y1="positionToY(pos)"
          :x2="NOTE_X + NOTE_RX + 6"
          :y2="positionToY(pos)"
          class="staff-line"
          stroke-width="1.5"
        />
      </template>

      <!-- Note head -->
      <ellipse
        v-if="notePosition !== null"
        :cx="NOTE_X"
        :cy="positionToY(notePosition)"
        :rx="NOTE_RX"
        :ry="NOTE_RY"
        :transform="`rotate(-15, ${NOTE_X}, ${positionToY(notePosition)})`"
        :fill="noteColor"
        class="note-head"
      />

      <!-- Note stem: up when note is on or below middle line (pos ≤ 4), down otherwise -->
      <line
        v-if="notePosition !== null"
        :x1="stemX1"
        :y1="positionToY(notePosition)"
        :x2="stemX1"
        :y2="stemY2"
        :stroke="noteColor"
        stroke-width="1.8"
      />
    </svg>

    <!-- Feedback flash -->
    <transition name="feedback">
      <div v-if="feedback" :class="['feedback-badge', feedback]">
        {{ feedback === 'correct' ? '✓' : '✗' }}
      </div>
    </transition>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  notePosition: { type: Number, default: null },
  clef: { type: String, default: 'sol' },
  feedback: { type: String, default: null },
})

const WIDTH = 320
const HEIGHT = 200
const NOTE_X = 200
const NOTE_RX = 10
const NOTE_RY = 7
const STEM_LENGTH = 45

const STAFF_TOP_Y = 55  // y of line 5 (top line)
const LINE_SPACING = 16  // pixels between adjacent staff lines

// Convert staff position to SVG y-coordinate.
// pos 0 = line 1 (bottom), pos 8 = line 5 (top); odd positions = spaces.
function positionToY(pos) {
  return STAFF_TOP_Y + (8 - pos) * (LINE_SPACING / 2)
}

// y-coordinate for staff line n (1 = bottom … 5 = top)
function lineY(n) {
  return positionToY((n - 1) * 2)
}

// Note color reflects feedback state
const noteColor = computed(() => {
  if (props.feedback === 'correct') return 'var(--success)'
  if (props.feedback === 'wrong') return 'var(--error)'
  return 'var(--text)'
})

// Stem goes up when note is at or below middle line (pos ≤ 4), down otherwise
const stemX1 = computed(() => {
  if (props.notePosition === null) return 0
  return props.notePosition <= 4
    ? NOTE_X + NOTE_RX - 1   // right side of head → stem up
    : NOTE_X - NOTE_RX + 1   // left side of head  → stem down
})

const stemY2 = computed(() => {
  if (props.notePosition === null) return 0
  const y = positionToY(props.notePosition)
  return props.notePosition <= 4 ? y - STEM_LENGTH : y + STEM_LENGTH
})

// Bass clef hook: open curved stroke starting at F line, arcing up and back.
// Drawn as a stroke (no fill) anchored to the filled dot at the F line.
const bassClefPath = computed(() => {
  const fy  = positionToY(6)       // F line (line 4)
  const top = positionToY(7) - 2   // target top of arc (just above space between lines 4-5)
  return `M 13,${fy} C 13,${top - 4} 26,${top - 8} 32,${top} C 38,${top + 8} 36,${fy + 6} 26,${fy + 8}`
})

// Ledger lines above the staff
const ledgerPositionsAbove = computed(() => {
  if (props.notePosition === null || props.notePosition <= 8) return []
  const lines = []
  for (let p = 10; p <= props.notePosition; p += 2) lines.push(p)
  return lines
})

// Ledger lines below the staff
const ledgerPositionsBelow = computed(() => {
  if (props.notePosition === null || props.notePosition >= 0) return []
  const lines = []
  for (let p = -2; p >= props.notePosition; p -= 2) lines.push(p)
  return lines
})
</script>

<style scoped>
.staff-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.staff-svg {
  width: 100%;
  max-width: 420px;
  height: auto;
  background: var(--surface);
  border-radius: 12px;
}

/* Staff lines and clef shapes adapt to dark/light via CSS variables */
.staff-line {
  stroke: var(--border);
}

.clef-shape {
  fill: var(--text-muted);
  stroke: var(--text-muted);
}

.clef-sol {
  font-size: 70px;
  fill: var(--text-muted);
  font-family: 'Segoe UI Symbol', 'Apple Symbols', 'Noto Music', 'FreeSerif', serif;
}

.note-head {
  transition: fill 0.15s ease;
}

.feedback-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  font-weight: 700;
  color: white;
}

.feedback-badge.correct { background: #22c55e; }
.feedback-badge.wrong   { background: #ef4444; }

.feedback-enter-active,
.feedback-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.feedback-enter-from,
.feedback-leave-to {
  opacity: 0;
  transform: scale(0.6);
}
</style>
