/**
 * Runs Basic Pitch on mono 22,050 Hz audio and returns raw note events.
 * Shared by the Web Worker (browser) and the Node round-trip test, so both exercise the same code.
 * Environment-agnostic: the caller provides the loaded model.
 */
import * as tf from '@tensorflow/tfjs';
import { noteFramesToTime } from '@spotify/basic-pitch';
import { outputToNotesPolyFast } from './note-decoder';
import type { RawNoteEvent } from './postprocess';

import { BASIC_PITCH_SAMPLE_RATE } from './constants';

export { BASIC_PITCH_SAMPLE_RATE };

/** Thresholds for Basic Pitch's own frame → note decoding (see docs/DECISIONS.md). */
export interface DecodeParams {
  /** Onset peak threshold (0–1). Basic Pitch default 0.5. */
  onsetThreshold: number;
  /** Frame activation threshold (0–1). Basic Pitch default 0.3. */
  frameThreshold: number;
  /** Minimum note length in model frames (~11.6 ms each). */
  minNoteFrames: number;
  /** Add notes found from leftover frame energy without an onset peak. */
  melodiaTrick: boolean;
  /** Count the first frame of a flat-topped onset peak as a peak (fix; see note-decoder.ts). */
  plateauPeaks: boolean;
}

/**
 * Chosen on the recording-like TUNING set (tests/fixtures/audio-realistic.ts; docs/DECISIONS.md,
 * round 2): onset 0.6 and no melodia trick (Basic Pitch's defaults are 0.5 / on), with the
 * flat-top onset-peak fix that melodia used to hide.
 */
export const DEFAULT_DECODE_PARAMS: DecodeParams = {
  onsetThreshold: 0.6,
  frameThreshold: 0.3,
  minNoteFrames: 5,
  melodiaTrick: false,
  plateauPeaks: true,
};

export class TranscriptionCancelled extends Error {
  constructor() {
    super('Transcription cancelled');
    this.name = 'TranscriptionCancelled';
  }
}

export interface ModelOutput {
  frames: number[][];
  onsets: number[][];
  /** Pitch contours: not read back from the model (unused by the note decoder). */
  contours?: number[][];
}

// Model geometry, as in @spotify/basic-pitch 1.0.1 src/inference.ts (Apache-2.0).
const FFT_HOP = 256;
const ANNOTATIONS_FPS = Math.floor(BASIC_PITCH_SAMPLE_RATE / FFT_HOP);
const WINDOW_SAMPLES = BASIC_PITCH_SAMPLE_RATE * 2 - FFT_HOP;
const N_OVERLAP_OVER_2 = 15;
const OVERLAP_SAMPLES = 2 * N_OVERLAP_OVER_2 * FFT_HOP;
const HOP_SAMPLES = WINDOW_SAMPLES - OVERLAP_SAMPLES;
const OUTPUT_FRAMES = 'Identity_1';
const OUTPUT_ONSETS = 'Identity_2';

/** Row-major [rows × cols] Float32Array → number[][] (same values as tensor.array()). */
function toRows(data: Float32Array, rows: number, cols: number): number[][] {
  const out: number[][] = new Array(rows);
  for (let r = 0; r < rows; r++) out[r] = Array.from(data.subarray(r * cols, (r + 1) * cols));
  return out;
}

/**
 * Runs the network only. A port of BasicPitch.evaluateModel (@spotify/basic-pitch 1.0.1,
 * Copyright 2022 Spotify AB, Apache-2.0) with the same windows and outputs, except that:
 * - the audio is split into 2 s windows in JS (same samples as its tf.signal.frame), so the GPU
 *   only ever sees [1, 43844, 1] inputs: one set of shader programs, compiled once at warm-up,
 *   serves every file length (the original compiled new programs for each new audio length);
 * - pitch contours are not read back (unused);
 * - windows after the last needed output frame are skipped.
 * Progress covers 0–1 (windows done / total); `isCancelled` is polled before each window.
 */
export async function runModel(
  model: tf.GraphModel | Promise<tf.GraphModel>,
  audio: Float32Array,
  onProgress: (fraction: number) => void = () => {},
  isCancelled: () => boolean = () => false,
): Promise<ModelOutput> {
  const m = await model;
  const out: ModelOutput = { frames: [], onsets: [] };
  // Zeros for half an overlap, then the audio; windows start every HOP_SAMPLES, zero-padded at the end.
  const lead = OVERLAP_SAMPLES / 2;
  const total = lead + audio.length;
  const windows = Math.max(1, Math.ceil(total / HOP_SAMPLES));
  const nOutputFrames = Math.floor(audio.length * (ANNOTATIONS_FPS / BASIC_PITCH_SAMPLE_RATE));
  const input = new Float32Array(WINDOW_SAMPLES);
  let calculated = 0;
  for (let i = 0; i < windows; i++) {
    if (isCancelled()) throw new TranscriptionCancelled();
    onProgress(i / windows);
    if (calculated >= nOutputFrames) continue;
    // Window i covers padded samples [i·HOP, i·HOP + WINDOW) = audio [start, start + WINDOW).
    input.fill(0);
    const start = i * HOP_SAMPLES - lead;
    const from = Math.max(0, start);
    const to = Math.min(audio.length, start + WINDOW_SAMPLES);
    if (to > from) input.set(audio.subarray(from, to), from - start);
    const [frames, onsets] = tf.tidy(() => {
      const x = tf.tensor3d(input, [1, WINDOW_SAMPLES, 1]);
      const [f, o] = m.execute(x, [OUTPUT_FRAMES, OUTPUT_ONSETS]) as tf.Tensor3D[];
      const unwrap = (t: tf.Tensor3D) => {
        const rows = t.shape[1] - 2 * N_OVERLAP_OVER_2;
        return t.slice([0, N_OVERLAP_OVER_2, 0], [-1, rows, -1]).reshape([rows, t.shape[2]]) as tf.Tensor2D;
      };
      return [unwrap(f!), unwrap(o!)];
    });
    try {
      const rows = frames.shape[0];
      const keep = Math.min(rows, nOutputFrames - calculated);
      const [fd, od] = await Promise.all([frames.data<'float32'>(), onsets.data<'float32'>()]);
      out.frames.push(...toRows(fd, keep, frames.shape[1]));
      out.onsets.push(...toRows(od, keep, onsets.shape[1]));
      calculated += rows;
    } finally {
      frames.dispose();
      onsets.dispose();
    }
  }
  onProgress(1);
  return out;
}

/**
 * Turns network activations into timed note events: Basic Pitch's own decoder, as a faster port
 * with identical output (./note-decoder.ts; the original is quadratic in the audio length).
 */
export function decodeNotes(out: ModelOutput, params: DecodeParams = DEFAULT_DECODE_PARAMS): RawNoteEvent[] {
  if (out.frames.length === 0) return [];
  const events = outputToNotesPolyFast(
    out.frames,
    out.onsets,
    params.onsetThreshold,
    params.frameThreshold,
    params.minNoteFrames,
    true,
    params.melodiaTrick,
    11,
    params.plateauPeaks ?? true,
  );
  const timed = noteFramesToTime(events);
  return events.map((ev, i) => {
    const e = timed[i]!;
    return {
      start: e.startTimeSeconds,
      duration: e.durationSeconds,
      pitch: e.pitchMidi,
      amplitude: e.amplitude,
      onsetStrength: onsetPeak(out.onsets, ev.startFrame, ev.pitchMidi - 21),
    };
  });
}

/** Strongest onset activation for a pitch bin within ±2 frames of a note start. */
function onsetPeak(onsets: number[][], frame: number, bin: number): number {
  let peak = 0;
  for (let f = Math.max(0, frame - 2); f <= Math.min(onsets.length - 1, frame + 2); f++) {
    peak = Math.max(peak, onsets[f]?.[bin] ?? 0);
  }
  return peak;
}
