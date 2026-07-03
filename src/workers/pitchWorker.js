// YIN pitch detection worker
// Receives: { samples: Float32Array, sampleRate: number }
// Posts:    { noteIdx: 0-6 | null, hz: number }

const YIN_THRESHOLD = 0.15;

// Chromatic pitch class (0=C … 11=B) → app note index (0=Do … 6=Si)
// null = black key, ignored
const CHROMATIC_TO_NOTE = [0, null, 1, null, 2, 3, null, 4, null, 5, null, 6];
//                          C  C#    D  D#    E  F  F#    G  G#    A  A#    B

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
	for (let tau = 2; tau < half - 1; tau++) {
		if (d[tau] < YIN_THRESHOLD && d[tau] <= d[tau + 1]) {
			// Step 4: parabolic interpolation for sub-sample precision
			const a = d[tau - 1],
				b = d[tau],
				c = d[tau + 1];
			const denom = 2 * (2 * b - a - c);
			const t = denom === 0 ? tau : tau + (c - a) / denom;
			return sampleRate / t;
		}
	}
	return -1; // no pitch found
}

self.onmessage = ({ data: { samples, sampleRate } }) => {
	const hz = yin(samples, sampleRate);
	if (hz < 50 || hz > 2100) {
		self.postMessage({ noteIdx: null, hz });
		return;
	}
	const midi = Math.round(12 * Math.log2(hz / 440) + 69);
	const chromatic = ((midi % 12) + 12) % 12;
	const noteIdx = CHROMATIC_TO_NOTE[chromatic] ?? null;
	self.postMessage({ noteIdx, hz });
};
