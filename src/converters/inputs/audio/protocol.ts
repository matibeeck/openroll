/** Messages between the audio converter (main thread) and src/workers/basic-pitch.worker.ts. */
import type { Score } from '../../../core/score';
import type { DecodeParams } from './basic-pitch-run';
import type { PostprocessOptions } from './postprocess';
import type { TimingSpan } from './timing';

/** Worker-side stages, in order. `loading-model` only happens on the first job of a worker. */
export type WorkerStage = 'loading-model' | 'transcribing' | 'finishing';

export type BasicPitchRequest =
  /** Pick the backend, load the model and run it once on silence (compiles GPU shaders). */
  | { type: 'warmup'; id: number; modelUrl: string }
  | {
      type: 'transcribe';
      id: number;
      /**
       * Decoded audio at 22,050 Hz, one array per channel (downmixed to mono in the worker).
       * Transferred, not copied.
       */
      channels: Float32Array[];
      /** Absolute URL of public/models/basic-pitch/model.json. */
      modelUrl: string;
      params?: Partial<DecodeParams>;
      postprocess?: Partial<PostprocessOptions>;
    }
  | { type: 'cancel'; id: number };

export type BasicPitchResponse =
  /**
   * `value` is the fraction of the current stage (0–1). For `loading-model` it steps through
   * backend → model → warm-up; for `transcribing` it is windows done / windows total.
   * `windows` (transcribing only) is the number of 2 s model windows of this job.
   */
  | { type: 'progress'; id: number; stage: WorkerStage; value: number; windows?: number }
  | {
      type: 'ready';
      id: number;
      backend: string;
      /** Measured time of one model window once warm (ms): basis for progress estimates. */
      windowMs: number;
      /** GPU programs compiled for the model (diagnostics; 0 on the CPU backend). */
      programs: number;
      spans: TimingSpan[];
    }
  | { type: 'result'; id: number; score: Score; backend: string; spans: TimingSpan[] }
  | { type: 'cancelled'; id: number }
  | { type: 'error'; id: number; message: string; code?: 'silent' };
