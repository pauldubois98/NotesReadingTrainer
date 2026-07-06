// Improved YIN pitch detection worker
// Receives: { samples: Float32Array, sampleRate: number }
// Posts:    { noteIdx: 0-6 | null, hz: number, confidence: number }

const YIN_THRESHOLD = 0.15;
const MIN_CONFIDENCE = 0.7;

// Chromatic pitch class (0=C … 11=B) → app note index (0=Do … 6=Si)
// null = black key, ignored
const CHROMATIC_TO_NOTE = [0, null, 1, null, 2, 3, null, 4, null, 5, null, 6];
//                          C  C#    D  D#    E  F  F#    G  G#    A  A#    B
// Piano note frequencies (MIDI 21-108 = A0-C8)
const PIANO_LOWEST = 27.5; // A0
const PIANO_HIGHEST = 4186; // C8

// Store last few detections for stability
let lastDetections = [];
const STABILITY_COUNT = 3; // Require 3 consistent detections

function yin(buf, sampleRate) {
	const half = buf.length >> 1;
	const d = new Float32Array(half);

	// Step 1: difference function
	for (let tau = 1; tau < half; tau++) {
		let s = 0;
		for (let j = 0; j < half; j++) {
			const x = buf[j] - buf[j + tau];
			s += x * x;
		}
		d[tau] = s;
	}

	// Step 2: cumulative mean normalized difference
	d[0] = 1;
	let runningSum = 0;
	for (let tau = 1; tau < half; tau++) {
		runningSum += d[tau];
		d[tau] = (d[tau] * tau) / runningSum;
	}

	// Step 3: find first dip below threshold
	let bestTau = -1;
	let bestValue = Infinity;
	for (let tau = 2; tau < half - 1; tau++) {
		if (d[tau] < YIN_THRESHOLD && d[tau] <= d[tau + 1]) {
			// Calculate confidence: lower value = higher confidence
			const confidence = 1 - d[tau];
			if (confidence > MIN_CONFIDENCE && d[tau] < bestValue) {
				bestValue = d[tau];
				bestTau = tau;
			}
		}
	}

	if (bestTau === -1) return { hz: -1, confidence: 0 };

	// Step 4: parabolic interpolation for sub-sample precision
	const a = d[bestTau - 1];
	const b = d[bestTau];
	const c = d[bestTau + 1];
	const denom = 2 * (2 * b - a - c);
	const t = denom === 0 ? bestTau : bestTau + (c - a) / denom;
	const hz = sampleRate / t;
	const confidence = 1 - bestValue;

	return { hz, confidence };
}

function hzToNoteIndex(hz) {
	if (hz < PIANO_LOWEST || hz > PIANO_HIGHEST) {
		return { noteIdx: null, hz, confidence: 0 };
	}
	
	const midi = 12 * Math.log2(hz / 440) + 69;
	const midiRounded = Math.round(midi);
	
	// Calculate cents deviation from nearest semitone
	const centsDeviation = Math.abs(midi - midiRounded) * 100;
	
	// Only accept if within ~50 cents (half semitone) of a note
	if (centsDeviation > 50) {
		return { noteIdx: null, hz, confidence: 0 };
	}
	
	const chromatic = ((midiRounded % 12) + 12) % 12;
	const noteIdx = CHROMATIC_TO_NOTE[chromatic];
	const confidence = noteIdx !== null ? Math.max(0, 1 - centsDeviation / 50) : 0;
	
	return { noteIdx, hz, confidence };
}

self.onmessage = ({ data: { samples, sampleRate } }) => {
	const result = yin(samples, sampleRate);
	
	if (result.hz < 0) {
		// No pitch detected - reset stability
		lastDetections = [];
		self.postMessage({ noteIdx: null, hz: 0, confidence: 0 });
		return;
	}
	
	const noteResult = hzToNoteIndex(result.hz);
	
	if (noteResult.noteIdx === null) {
		// Not a white key or out of piano range
		lastDetections = [];
		self.postMessage({ noteIdx: null, hz: noteResult.hz, confidence: 0 });
		return;
	}
	
	// Check stability: require multiple consistent detections
	const detection = {
		noteIdx: noteResult.noteIdx,
		hz: noteResult.hz,
		confidence: noteResult.confidence * result.confidence
	};
	
	lastDetections.push(detection);
	
	// If we have enough consistent detections, send it
	if (lastDetections.length >= STABILITY_COUNT) {
		// Check if all recent detections are the same note
		const first = lastDetections[0];
		const allSame = lastDetections.every(d => 
			d.noteIdx === first.noteIdx && 
			Math.abs(d.hz - first.hz) < 5
		);
		
		if (allSame) {
			// Calculate average
			const avgHz = lastDetections.reduce((sum, d) => sum + d.hz, 0) / lastDetections.length;
			const avgConfidence = lastDetections.reduce((sum, d) => sum + d.confidence, 0) / lastDetections.length;
			
			self.postMessage({ 
				noteIdx: first.noteIdx, 
				hz: avgHz,
				confidence: avgConfidence 
			});
			lastDetections = []; // Reset after successful detection
		} else {
			// Detections not consistent - reset
			lastDetections = [];
		}
	}
};
