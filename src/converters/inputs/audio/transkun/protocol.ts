/** Messages between the high-precision client (main thread) and src/workers/transkun.worker.ts. */
import type { Score } from '../../../../core/score';
import type { TimingSpan } from '../timing';

export interface TranskunRequest {
  type: 'transcribe';
  id: number;
  /** Decoded audio at 44,100 Hz, one array per channel. Transferred, not copied. */
  channels: Float32Array[];
  /** Absolute URL of the folder with transkun.onnx and transkun-heads.onnx (same origin). */
  modelBase: string;
  title: string;
}

/**
 * Worker stages: `downloading-model` (bytes of model + runtime; skipped by the HTTP / service-worker
 * cache after the first time), `loading-model` (WebGPU / WebAssembly session set-up), `transcribing`
 * (one step per 16 s segment), `finishing`.
 */
export type TranskunStage = 'downloading-model' | 'loading-model' | 'transcribing' | 'finishing';

export type TranskunResponse =
  | {
      type: 'progress';
      id: number;
      stage: TranskunStage;
      /** Fraction of the stage (0–1). */
      value: number;
      /** downloading-model: bytes so far / expected. transcribing: segments done / total. */
      done?: number;
      total?: number;
    }
  | { type: 'result'; id: number; score: Score; backend: string; spans: TimingSpan[] }
  | { type: 'error'; id: number; message: string; code?: 'silent' | 'model-missing' };
