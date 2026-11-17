/**
 * Runs Basic Pitch on mono 22,050 Hz audio and returns raw note events.
 * Shared by the Web Worker (browser) and the Node round-trip test, so both exercise the same code.
 * Environment-agnostic: the caller provides the loaded model.
 */
import * as tf from '@tensorflow/tfjs';
import { BasicPitch, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch';
import type { RawNoteEvent } from './postprocess';

export { BASIC_PITCH_SAMPLE_RATE } from './constants';

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
}

export const DEFAULT_DECODE_PARAMS: DecodeParams = {
  onsetThreshold: 0.5,
  frameThreshold: 0.3,
  minNoteFrames: 5,
  melodiaTrick: true,
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
  contours: number[][];
}

/** Runs the network only. Progress covers 0–1; `isCancelled` is polled between 2 s windows. */
export async function runModel(
  model: tf.GraphModel | Promise<tf.GraphModel>,
  audio: Float32Array,
  onProgress: (fraction: number) => void = () => {},
  isCancelled: () => boolean = () => false,
): Promise<ModelOutput> {
  const bp = new BasicPitch(Promise.resolve(model));
  const out: ModelOutput = { frames: [], onsets: [], contours: [] };
  // basic-pitch-ts does not dispose its intermediate tensors; a scope frees them all at the end.
  tf.engine().startScope();
  try {
    await bp.evaluateModel(
      audio,
      (f, o, c) => {
        out.frames.push(...f);
        out.onsets.push(...o);
        out.contours.push(...c);
      },
      (p) => {
        if (isCancelled()) throw new TranscriptionCancelled();
        onProgress(p);
      },
    );
  } finally {
    tf.engine().endScope();
  }
  return out;
}

/** Turns network activations into timed note events (Basic Pitch's own decoder). */
export function decodeNotes(out: ModelOutput, params: DecodeParams = DEFAULT_DECODE_PARAMS): RawNoteEvent[] {
  if (out.frames.length === 0) return [];
  const events = outputToNotesPoly(
    out.frames,
    // outputToNotesPoly mutates its inputs; give it copies so the output can be re-decoded.
    out.onsets.map((r) => r.slice()),
    params.onsetThreshold,
    params.frameThreshold,
    params.minNoteFrames,
    true,
    null,
    null,
    params.melodiaTrick,
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
