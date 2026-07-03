/**
 * Keyword-spotting worker — pure JS, no WASM / ORT.
 * Loads kws_model.json (~750 KB), then classifies in < 1 ms per utterance.
 */

let M = null; // model weights + feature params

// ── Mel spectrogram helpers ───────────────────────────────────────────────────

let windowFn = null;
let filterbank = null; // Float32Array, row-major (n_mels × bins)

function buildWindow(n) {
	const w = new Float32Array(n);
	for (let i = 0; i < n; i++)
		w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
	return w;
}

// Radix-2 in-place FFT
function fft(re, im) {
	const N = re.length;
	let j = 0;
	for (let i = 1; i < N; i++) {
		let bit = N >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[re[i], re[j]] = [re[j], re[i]];
			[im[i], im[j]] = [im[j], im[i]];
		}
	}
	for (let len = 2; len <= N; len <<= 1) {
		const ang = (-2 * Math.PI) / len;
		const wR = Math.cos(ang),
			wI = Math.sin(ang);
		for (let i = 0; i < N; i += len) {
			let cR = 1,
				cI = 0;
			for (let k = 0; k < len >> 1; k++) {
				const uR = re[i + k],
					uI = im[i + k];
				const h = i + k + (len >> 1);
				const vR = re[h] * cR - im[h] * cI,
					vI = re[h] * cI + im[h] * cR;
				re[i + k] = uR + vR;
				im[i + k] = uI + vI;
				re[h] = uR - vR;
				im[h] = uI - vI;
				const nr = cR * wR - cI * wI;
				cI = cR * wI + cI * wR;
				cR = nr;
			}
		}
	}
}

function melSpec(samples) {
	const { n_fft, hop, n_mels, n_frames } = M;
	const bins = n_fft / 2 + 1;
	const need = (n_frames - 1) * hop + n_fft;
	let s =
		samples.length < need
			? (() => {
					const p = new Float32Array(need);
					p.set(samples);
					return p;
				})()
			: samples.subarray(0, need);

	const reArr = new Float32Array(n_fft);
	const imArr = new Float32Array(n_fft);
	const S = new Float32Array(n_mels * n_frames);

	for (let t = 0; t < n_frames; t++) {
		reArr.fill(0);
		imArr.fill(0);
		for (let k = 0; k < n_fft; k++) reArr[k] = s[t * hop + k] * windowFn[k];
		fft(reArr, imArr);
		for (let m = 0; m < n_mels; m++) {
			let e = 0,
				row = m * bins;
			for (let b = 0; b < bins; b++)
				e += filterbank[row + b] * (reArr[b] * reArr[b] + imArr[b] * imArr[b]);
			S[m * n_frames + t] = Math.log(e + 1e-8);
		}
	}
	return S; // (n_mels × n_frames), row-major
}

function trimSilence(samples) {
	// Trim leading AND trailing silence so that feature extraction operates only
	// on the speech segment — matching how training clips were already segmented.
	// Room noise (non-zero "silence") would otherwise shift g_mean and abs_delta
	// away from the values the model learned during training.
	const frameLen = M.hop;
	const nFrames = Math.floor(samples.length / frameLen);
	const rms = new Float32Array(nFrames);
	let peakRms = 0;

	for (let t = 0; t < nFrames; t++) {
		let s = 0;
		for (let i = 0; i < frameLen; i++) {
			const v = samples[t * frameLen + i];
			s += v * v;
		}
		rms[t] = Math.sqrt(s / frameLen);
		if (rms[t] > peakRms) peakRms = rms[t];
	}

	const threshold = peakRms * 0.05;
	let onset = 0;
	let offset = nFrames - 1;
	for (let t = 0; t < nFrames; t++) {
		if (rms[t] >= threshold) {
			onset = t;
			break;
		}
	}
	for (let t = nFrames - 1; t >= 0; t--) {
		if (rms[t] >= threshold) {
			offset = t;
			break;
		}
	}

	const start = Math.max(0, (onset - 2) * frameLen);
	const end = Math.min(samples.length, (offset + 3) * frameLen);
	return samples.subarray(start, end);
}

function extractFeatures(samples) {
	const { n_mels, n_frames, onset_frames } = M;
	const aligned = trimSilence(samples);
	const S = melSpec(aligned); // (n_mels × n_frames)

	const gMean = new Float32Array(n_mels);
	const gStd = new Float32Array(n_mels);
	const oMean = new Float32Array(n_mels);
	const absDelta = new Float32Array(n_mels);

	for (let m = 0; m < n_mels; m++) {
		let sum = 0,
			sum2 = 0,
			osum = 0,
			dsum = 0;
		for (let t = 0; t < n_frames; t++) {
			const v = S[m * n_frames + t];
			sum += v;
			sum2 += v * v;
		}
		for (let t = 0; t < onset_frames; t++) osum += S[m * n_frames + t];
		for (let t = 0; t < n_frames - 1; t++)
			dsum += Math.abs(S[m * n_frames + t + 1] - S[m * n_frames + t]);
		const mean = sum / n_frames;
		gMean[m] = mean;
		gStd[m] = Math.sqrt(sum2 / n_frames - mean * mean);
		oMean[m] = osum / onset_frames;
		absDelta[m] = dsum / (n_frames - 1);
	}

	// Concatenate [mean | std | onset | absDelta] and normalise
	const feat = new Float32Array(n_mels * 4);
	feat.set(gMean, 0);
	feat.set(gStd, n_mels);
	feat.set(oMean, n_mels * 2);
	feat.set(absDelta, n_mels * 3);
	let fSum = 0,
		fSum2 = 0;
	for (let i = 0; i < feat.length; i++) {
		fSum += feat[i];
		fSum2 += feat[i] * feat[i];
	}
	const fMu = fSum / feat.length;
	const fSig = Math.sqrt(fSum2 / feat.length - fMu * fMu) || 1;
	for (let i = 0; i < feat.length; i++) feat[i] = (feat[i] - fMu) / fSig;
	return feat;
}

// ── MLP forward pass ──────────────────────────────────────────────────────────

function linear(x, W, b) {
	const nOut = W.length,
		nIn = x.length;
	const out = new Float32Array(nOut);
	for (let i = 0; i < nOut; i++) {
		let s = b[i],
			row = W[i];
		for (let j = 0; j < nIn; j++) s += row[j] * x[j];
		out[i] = s;
	}
	return out;
}

function batchNorm(x, w, b, mean, variance) {
	const out = new Float32Array(x.length);
	for (let i = 0; i < x.length; i++)
		out[i] = (w[i] * (x[i] - mean[i])) / Math.sqrt(variance[i] + 1e-5) + b[i];
	return out;
}

function relu(x) {
	for (let i = 0; i < x.length; i++) if (x[i] < 0) x[i] = 0;
	return x;
}

function mlpForward(feat) {
	let x = feat;
	x = relu(
		batchNorm(linear(x, M.w0, M.b0), M.bn0_w, M.bn0_b, M.bn0_mean, M.bn0_var),
	);
	x = relu(
		batchNorm(linear(x, M.w1, M.b1), M.bn1_w, M.bn1_b, M.bn1_mean, M.bn1_var),
	);
	x = linear(x, M.w2, M.b2);
	return x; // logits
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
	const cfg = await fetch(`${self.location.origin}/kws_model.json`).then((r) =>
		r.json(),
	);
	M = cfg;
	windowFn = buildWindow(cfg.n_fft);
	filterbank = new Float32Array(cfg.filterbank.flat());
	// Pre-convert weight arrays to Float32Array for speed
	M.w0 = cfg.w0.map((row) => new Float32Array(row));
	M.b0 = new Float32Array(cfg.b0);
	M.bn0_w = new Float32Array(cfg.bn0_w);
	M.bn0_b = new Float32Array(cfg.bn0_b);
	M.bn0_mean = new Float32Array(cfg.bn0_mean);
	M.bn0_var = new Float32Array(cfg.bn0_var);
	M.w1 = cfg.w1.map((row) => new Float32Array(row));
	M.b1 = new Float32Array(cfg.b1);
	M.bn1_w = new Float32Array(cfg.bn1_w);
	M.bn1_b = new Float32Array(cfg.bn1_b);
	M.bn1_mean = new Float32Array(cfg.bn1_mean);
	M.bn1_var = new Float32Array(cfg.bn1_var);
	M.w2 = cfg.w2.map((row) => new Float32Array(row));
	M.b2 = new Float32Array(cfg.b2);

	self.postMessage({ type: "ready" });
}

// ── Personal model (user-recorded softmax classifier) ─────────────────────────

let personalData = []; // [{feat: Float32Array, label: number}]
let personalModel = null; // {W: Float32Array(7×256), b: Float32Array(7)} or null
let collectCounts = [0, 0, 0, 0, 0, 0, 0];

function softmax(logits) {
	let maxL = logits[0];
	for (let i = 1; i < logits.length; i++)
		if (logits[i] > maxL) maxL = logits[i];
	let sumE = 0;
	const exps = new Float32Array(logits.length);
	for (let i = 0; i < logits.length; i++) {
		exps[i] = Math.exp(logits[i] - maxL);
		sumE += exps[i];
	}
	for (let i = 0; i < logits.length; i++) exps[i] /= sumE;
	return exps;
}

function personalForward(feat, W, b) {
	const nClass = 7,
		nFeat = feat.length;
	const logits = new Float32Array(nClass);
	for (let c = 0; c < nClass; c++) {
		let s = b[c];
		for (let j = 0; j < nFeat; j++) s += W[c * nFeat + j] * feat[j];
		logits[c] = s;
	}
	return logits;
}

function trainPersonal() {
	const features = personalData.map((d) => d.feat);
	const labels = personalData.map((d) => d.label);
	const nFeat = features[0].length; // 256
	const nClass = 7;
	const nSamples = features.length;
	const epochs = 500;
	const lr = 0.05;
	const l2 = 0.001; // regularisation

	const W = new Float32Array(nClass * nFeat);
	const b = new Float32Array(nClass);
	for (let i = 0; i < W.length; i++) W[i] = (Math.random() - 0.5) * 0.01;

	const idx = Array.from({ length: nSamples }, (_, i) => i);
	for (let ep = 0; ep < epochs; ep++) {
		for (let i = nSamples - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[idx[i], idx[j]] = [idx[j], idx[i]];
		}
		for (const i of idx) {
			const x = features[i],
				y = labels[i];
			const probs = softmax(personalForward(x, W, b));
			for (let c = 0; c < nClass; c++) {
				const dc = probs[c] - (c === y ? 1 : 0);
				b[c] -= lr * dc;
				for (let j = 0; j < nFeat; j++)
					W[c * nFeat + j] -= lr * (dc * x[j] + l2 * W[c * nFeat + j]);
			}
		}
	}

	let correct = 0;
	for (let i = 0; i < nSamples; i++) {
		const logits = personalForward(features[i], W, b);
		let maxL = logits[0],
			pred = 0;
		for (let c = 1; c < nClass; c++)
			if (logits[c] > maxL) {
				maxL = logits[c];
				pred = c;
			}
		if (pred === labels[i]) correct++;
	}

	personalModel = { W, b };
	return { W: Array.from(W), b: Array.from(b), accuracy: correct / nSamples };
}

// ── Inference ─────────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.75;

function transcribe(audio) {
	const t0 = performance.now();
	const feat = extractFeatures(audio);
	const logits = personalModel
		? personalForward(feat, personalModel.W, personalModel.b)
		: mlpForward(feat);

	const probs = softmax(logits);
	let maxConf = probs[0],
		noteIdx = 0;
	for (let i = 1; i < probs.length; i++)
		if (probs[i] > maxConf) {
			maxConf = probs[i];
			noteIdx = i;
		}
	const ms = (performance.now() - t0).toFixed(1);

	if (maxConf < CONFIDENCE_THRESHOLD) {
		self.postMessage({ type: "result", note: null, conf: maxConf });
		return;
	}
	self.postMessage({
		type: "result",
		note: noteIdx,
		label: M.labels[noteIdx],
		conf: maxConf,
		ms,
	});
}

// ── Message handler ───────────────────────────────────────────────────────────

self.addEventListener("message", (e) => {
	const { type } = e.data;

	if (type === "init") {
		init().catch((err) =>
			self.postMessage({ type: "error", message: err.message }),
		);
	}

	if (type === "transcribe") {
		transcribe(e.data.audio);
	}

	if (type === "collect") {
		if (!M) return;
		const feat = extractFeatures(e.data.audio);
		personalData.push({ feat, label: e.data.label });
		collectCounts[e.data.label]++;
		self.postMessage({
			type: "collected",
			label: e.data.label,
			count: collectCounts[e.data.label],
			counts: [...collectCounts],
		});
	}

	if (type === "train") {
		if (personalData.length < 7) return;
		const result = trainPersonal();
		self.postMessage({ type: "trained", ...result });
	}

	if (type === "reset_personal") {
		personalData = [];
		personalModel = null;
		collectCounts = [0, 0, 0, 0, 0, 0, 0];
		self.postMessage({ type: "personal_reset" });
	}

	if (type === "load_personal") {
		personalModel = {
			W: new Float32Array(e.data.W),
			b: new Float32Array(e.data.b),
		};
	}
});
