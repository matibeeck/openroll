/** Pure sample helpers shared by the main thread, the worker and Node tests. No DOM. */

/** Averages all channels into one (the single channel itself when there is only one). */
export function downmix(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const len = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(len);
  for (const c of channels) for (let i = 0; i < len; i++) out[i]! += c[i]! / channels.length;
  return out;
}

/** Largest absolute sample value. */
export function peakLevel(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]!);
    if (v > peak) peak = v;
  }
  return peak;
}

/** Below this peak level a recording counts as silent (nothing to transcribe). */
export const SILENCE_PEAK = 1e-4;

/** Basic Pitch model geometry (inference.ts of @spotify/basic-pitch 1.0.1). */
const FFT_HOP = 256;
const WINDOW_SAMPLES = 22050 * 2 - FFT_HOP;
const OVERLAP_SAMPLES = 30 * FFT_HOP;
const HOP_SAMPLES = WINDOW_SAMPLES - OVERLAP_SAMPLES;

/**
 * Number of 2 s windows Basic Pitch runs for `samples` samples at 22,050 Hz (the audio is
 * prefixed with half an overlap of zeros, then framed with padding at the end).
 */
export function modelWindows(samples: number): number {
  return Math.max(1, Math.ceil((samples + OVERLAP_SAMPLES / 2) / HOP_SAMPLES));
}
