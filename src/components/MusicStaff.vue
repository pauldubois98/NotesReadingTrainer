<template>
  <div class="staff-wrapper">
    <svg :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" class="staff-svg" role="img" aria-label="Music staff">

      <!-- Staff lines (run through the clef and the full note area) -->
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

      <!-- ── Treble clef (Sol, always line 2) ──────────────────── -->
      <text
        v-if="clefBase === 'sol'"
        :x="36"
        :y="positionToY(2) + 8"
        class="clef-symbol clef-sol"
        text-anchor="middle"
        dominant-baseline="alphabetic"
      >𝄞</text>

      <!-- ── Fa clef (line 3 or 4) ──────────────────────────────── -->
      <g v-else-if="clefBase === 'fa'">
        <circle :cx="13" :cy="positionToY(clefPos)" r="5.5" class="clef-shape" />
        <path :d="bassClefPath" fill="none" class="clef-shape" stroke-width="3.5" stroke-linecap="round" />
        <circle :cx="44" :cy="positionToY(clefPos + 1)" r="3" class="clef-shape" />
        <circle :cx="44" :cy="positionToY(clefPos - 1)" r="3" class="clef-shape" />
      </g>

      <!-- ── Do C clef (line 1–4) ─────────────────────────────── -->
      <g v-else>
        <rect :x="4" :y="positionToY(8) - 2" width="7" :height="positionToY(0) - positionToY(8) + 4" rx="2" class="clef-shape" />
        <line :x1="11" :y1="positionToY(8)" :x2="37" :y2="positionToY(clefPos)" class="clef-shape" stroke-width="4.5" stroke-linecap="round" />
        <line :x1="11" :y1="positionToY(0)" :x2="37" :y2="positionToY(clefPos)" class="clef-shape" stroke-width="4.5" stroke-linecap="round" />
        <rect :x="35" :y="positionToY(clefPos + 2)" width="5" :height="positionToY(clefPos - 2) - positionToY(clefPos + 2)" rx="2" class="clef-shape" />
      </g>

      <!-- ── Note history (up to 3 notes, newest on the right) ─── -->
      <!--
        Each note group is translated to its x-slot.
        CSS transition on transform produces the slide-left animation.
      -->
      <g
        v-for="(item, idx) in displayItems"
        :key="item.id"
        :style="{
          transform: `translateX(${slotX(idx)}px)`,
          transition: 'transform 0.28s ease',
          opacity: isCurrent(idx) ? 1 : 0.45,
        }"
      >
        <!-- Ledger lines above the staff (positions are relative: x1/x2 are offsets from 0) -->
        <line
          v-for="lp in ledgerAbove(item.pos)"
          :key="`a${lp}`"
          :x1="-(NOTE_RX + 6)"
          :y1="positionToY(lp)"
          :x2="NOTE_RX + 6"
          :y2="positionToY(lp)"
          class="staff-line"
          stroke-width="1.5"
        />
        <!-- Ledger lines below the staff -->
        <line
          v-for="lp in ledgerBelow(item.pos)"
          :key="`b${lp}`"
          :x1="-(NOTE_RX + 6)"
          :y1="positionToY(lp)"
          :x2="NOTE_RX + 6"
          :y2="positionToY(lp)"
          class="staff-line"
          stroke-width="1.5"
        />
        <!-- Note head -->
        <ellipse
          cx="0"
          :cy="positionToY(item.pos)"
          :rx="NOTE_RX"
          :ry="NOTE_RY"
          :transform="`rotate(-15, 0, ${positionToY(item.pos)})`"
          :fill="noteFill(idx)"
          class="note-head"
        />
        <!-- Stem -->
        <line
          :x1="stemOffX(item.pos)"
          :y1="positionToY(item.pos)"
          :x2="stemOffX(item.pos)"
          :y2="stemEndY(item.pos)"
          :stroke="noteFill(idx)"
          stroke-width="1.8"
        />
      </g>
    </svg>

    <!-- Feedback badge (correct / wrong flash) -->
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
  noteHistory: { type: Array, default: () => [] },
  clef:        { type: String, default: 'sol' },
  feedback:    { type: String, default: null },
  maxHistory:  { type: Number, default: 3 },
})

const WIDTH  = 320
const HEIGHT = 200
const NOTE_RX = 10
const NOTE_RY = 7
const STEM_LENGTH = 45

const STAFF_TOP_Y  = 55
const LINE_SPACING = 16

// x positions for up to 6 note slots (oldest → … → current)
const X_SLOTS = [68, 106, 144, 182, 220, 258]

function positionToY(pos) {
  return STAFF_TOP_Y + (8 - pos) * (LINE_SPACING / 2)
}
function lineY(n) {
  return positionToY((n - 1) * 2)
}

// Total visible slots = past notes (capped by maxHistory) + 1 current
const MAX_SLOTS = 6  // hard visual maximum (X_SLOTS has 6 entries)

const displayItems = computed(() => {
  const limit = Math.min(props.maxHistory, MAX_SLOTS - 1) + 1  // past + current
  return props.noteHistory.slice(-limit)
})

// x coordinate for item at index idx within displayItems
function slotX(idx) {
  const offset = MAX_SLOTS - displayItems.value.length
  return X_SLOTS[idx + offset]
}

// Is this the current (rightmost / active) note?
function isCurrent(idx) {
  return idx === displayItems.value.length - 1
}

// Fill color per note slot
function noteFill(idx) {
  if (isCurrent(idx)) {
    if (props.feedback === 'correct') return 'var(--success)'
    if (props.feedback === 'wrong')   return 'var(--error)'
    return 'var(--text)'
  }
  // Past notes are always correct (notes only advance on a correct answer)
  return 'var(--success)'
}

// Stem: goes up (from right side of head) when note is on or below middle line
function stemOffX(pos) { return pos <= 4 ? NOTE_RX - 1 : -(NOTE_RX - 1) }
function stemEndY(pos) {
  const y = positionToY(pos)
  return pos <= 4 ? y - STEM_LENGTH : y + STEM_LENGTH
}

// Ledger lines (positions relative to note group's origin at x=0)
function ledgerAbove(pos) {
  if (pos <= 8) return []
  const r = []
  for (let p = 10; p <= pos; p += 2) r.push(p)
  return r
}
function ledgerBelow(pos) {
  if (pos >= 0) return []
  const r = []
  for (let p = -2; p >= pos; p -= 2) r.push(p)
  return r
}

// Parse clef key (e.g. 'do3', 'fa4', 'sol2') into base type and staff position
const clefBase = computed(() => {
  const c = props.clef
  if (c.startsWith('sol')) return 'sol'
  if (c.startsWith('do'))  return 'do'
  return 'fa'
})
const clefLine = computed(() => parseInt(props.clef.slice(-1)) || 2)
// Staff position of the reference line: line n → pos (n-1)*2
const clefPos  = computed(() => (clefLine.value - 1) * 2)

// Fa clef hook path anchored at the F reference line (clefPos)
const bassClefPath = computed(() => {
  const fy  = positionToY(clefPos.value)
  const top = positionToY(clefPos.value + 1) - 2
  return `M 13,${fy} C 13,${top - 4} 26,${top - 8} 32,${top} C 38,${top + 8} 36,${fy + 6} 26,${fy + 8}`
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

.staff-line  { stroke: var(--border); }
.clef-shape  { fill: var(--text-muted); stroke: var(--text-muted); }

.clef-sol {
  font-size: 70px;
  fill: var(--text-muted);
  font-family: 'Segoe UI Symbol', 'Apple Symbols', 'Noto Music', 'FreeSerif', serif;
}

.note-head { transition: fill 0.15s ease; }

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
.feedback-badge.correct { background: var(--success); }
.feedback-badge.wrong   { background: var(--error); }

.feedback-enter-active, .feedback-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.feedback-enter-from, .feedback-leave-to {
  opacity: 0;
  transform: scale(0.6);
}
</style>
