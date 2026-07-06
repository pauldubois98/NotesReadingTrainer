import { ref, onUnmounted, watch } from "vue";

export function usePitchInput({ onNote, micThreshold, lastHeardHz }) {
	const isSupported = ref(
		typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
	);
	const isListening = ref(false);

	let audioCtx = null;
	let stream = null;
	let source = null;
	let processor = null;
	let worker = null;
	let prevRms = 0;
	let lastFireTime = 0;
	let clearTimer = null;
	const MIN_CONFIDENCE = 0.75; // Only accept high-confidence detections

	async function start() {
		worker = new Worker(new URL("../workers/pitchWorker.js", import.meta.url), {
			type: "module",
		});

		worker.onmessage = ({ data: { noteIdx, hz, confidence } }) => {
			if (noteIdx === null) return;
			
			// Only accept detections with sufficient confidence
			if (confidence < MIN_CONFIDENCE) {
				return;
			}
			
			const now = Date.now();
			// Reduced debounce for faster response (from 800ms to 400ms)
			if (now - lastFireTime < 400) return;
			lastFireTime = now;
			lastHeardHz.value = hz;
			clearTimeout(clearTimer);
			clearTimer = setTimeout(() => {
				lastHeardHz.value = 0;
			}, 1500);
			onNote(noteIdx);
		};

		try {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: true,
				video: false,
			});
		} catch {
			isListening.value = false;
			return;
		}

		audioCtx = new AudioContext({ sampleRate: 16000 });
		source = audioCtx.createMediaStreamSource(stream);
		// 4096-sample buffer = 256ms at 16kHz — covers two periods of notes down to ~125Hz
		processor = audioCtx.createScriptProcessor(4096, 1, 1);
		source.connect(processor);
		processor.connect(audioCtx.destination);

		processor.onaudioprocess = (e) => {
			const buf = e.inputBuffer.getChannelData(0);

			// RMS energy of this frame
			let sum = 0;
			for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
			const rms = Math.sqrt(sum / buf.length);

			// Minimum energy gate (respect mic threshold slider: 0-90 → 0.005-0.05)
			const gate = Math.max(0.005, (micThreshold.value / 100) * 0.08);

			// Onset: energy spike (1.8× previous frame) AND above gate
			if (rms > gate && rms > prevRms * 1.8) {
				worker.postMessage({ samples: buf.slice(), sampleRate: 16000 });
			}
			prevRms = rms;
		};

		isListening.value = true;
	}

	function stop() {
		try {
			processor?.disconnect();
		} catch {
			/* ignore */
		}
		try {
			source?.disconnect();
		} catch {
			/* ignore */
		}
		try {
			audioCtx?.close();
		} catch {
			/* ignore */
		}
		stream?.getTracks().forEach((t) => t.stop());
		worker?.terminate();
		processor = source = audioCtx = stream = worker = null;
		prevRms = 0;
		isListening.value = false;
	}

	function toggle() {
		if (isListening.value) stop();
		else start();
	}

	onUnmounted(stop);

	return { isSupported, isListening, toggle };
}
