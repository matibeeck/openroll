/** Messages between the audio converter (main thread) and src/workers/basic-pitch.worker.ts. */
import type { DecodeParams } from './basic-pitch-run';
import type { RawNoteEvent } from './postprocess';

export type BasicPitchRequest =
  | {
      type: 'transcribe';
      /** Mono, 22,050 Hz. Transferred, not copied. */
      audio: Float32Array;
      /** Absolute URL of public/models/basic-pitch/model.json. */
      modelUrl: string;
      params?: Partial<DecodeParams>;
    }
  | { type: 'cancel' };

export type BasicPitchResponse =
  | { type: 'progress'; value: number; stage: 'loading-model' | 'transcribing' | 'decoding-notes' }
  | { type: 'result'; notes: RawNoteEvent[]; backend: string }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };
