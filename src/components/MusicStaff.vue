<template>
  <div class="staff-wrapper">
    <svg :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" class="staff-svg" role="img" aria-label="Music staff">
      <!-- Staff lines -->
      <line
        v-for="i in 5"
        :key="i"
        :x1="CLEF_WIDTH"
        :y1="lineY(i)"
        :x2="WIDTH - 20"
        :y2="lineY(i)"
        stroke="#cbd5e1"
        stroke-width="1.5"
      />

      <!-- Clef symbol -->
      <text
        :x="CLEF_WIDTH - 10"
        :y="clefTextY"
        class="clef-symbol"
        text-anchor="end"
        dominant-baseline="middle"
      >{{ clefSymbol }}</text>

      <!-- Ledger lines above staff -->
      <template v-if="notePosition > 8">
        <line
          v-for="pos in ledgerPositionsAbove"
          :key="`above-${pos}`"
          :x1="NOTE_X - NOTE_RX - 6"
          :y1="positionToY(pos)"
          :x2="NOTE_X + NOTE_RX + 6"
          :y2="positionToY(pos)"
          stroke="#cbd5e1"
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
          stroke="#cbd5e1"
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

      <!-- Note stem -->
      <line
        v-if="notePosition !== null"
        :x1="NOTE_X + NOTE_RX - 1"
        :y1="positionToY(notePosition)"
        :x2="NOTE_X + NOTE_RX - 1"
        :y2="positionToY(notePosition) - STEM_LENGTH"
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
  clef: { type: String, default: 'fa' },
  feedback: { type: String, default: null },
})

const WIDTH = 320
const HEIGHT = 160
const CLEF_WIDTH = 60
const NOTE_X = 200
const NOTE_RX = 10
const NOTE_RY = 7
const STEM_LENGTH = 45

// Staff: 5 lines. Line 1 = bottom, line 5 = top.
// Position 0 = line 1, position 2 = line 2, ..., position 8 = line 5
// Odd positions = spaces between lines
const STAFF_TOP_Y = 40
const LINE_SPACING = 16 // pixels between adjacent lines

// Convert staff position (0=line1 bottom, 8=line5 top) to SVG y
function positionToY(pos) {
  return STAFF_TOP_Y + (8 - pos) * (LINE_SPACING / 2)
}

// Y coordinate for each staff line (1=bottom ... 5=top)
function lineY(lineNum) {
  return positionToY((lineNum - 1) * 2)
}

const clefSymbol = computed(() => {
  if (props.clef === 'sol') return '𝄞'
  if (props.clef === 'fa') return '𝄢'
  return '𝄡' // do
})

const clefTextY = computed(() => {
  if (props.clef === 'sol') return positionToY(2) // G curl on line 2 (pos 2)
  if (props.clef === 'fa') return positionToY(6)  // F on line 4 (pos 6)
  return positionToY(4) // C on line 3 (pos 4) for alto
})

const noteColor = computed(() => {
  if (props.feedback === 'correct') return '#22c55e'
  if (props.feedback === 'wrong') return '#ef4444'
  return '#e2e8f0'
})

// Ledger line positions for notes outside the staff
const ledgerPositionsAbove = computed(() => {
  if (props.notePosition === null || props.notePosition <= 8) return []
  const lines = []
  for (let p = 10; p <= props.notePosition; p += 2) lines.push(p)
  return lines
})

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
  max-width: 380px;
  height: auto;
  background: #1e293b;
  border-radius: 12px;
  padding: 8px;
}

.clef-symbol {
  font-size: 52px;
  fill: #94a3b8;
  font-family: 'Segoe UI Symbol', 'Apple Symbols', serif;
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

.feedback-badge.correct {
  background: #22c55e;
}

.feedback-badge.wrong {
  background: #ef4444;
}

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
