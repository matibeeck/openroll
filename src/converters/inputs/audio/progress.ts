/**
 * Progress of an audio / performance-video conversion: one fraction (0–1) that only goes up and
 * grows roughly in proportion to elapsed time, plus a stage label. Pure (no DOM), unit-tested.
 *
 * Shape (labels are the `stage.*` i18n keys):
 *   reading          0     → 0.02   file.arrayBuffer()
 *   decoding         0.02  → 0.06   decodeAudioData (+ resample)
 *   loading-model    0.06  → a      only while the model is not warm yet; 0 width when warm
 *   transcribing     a     → b      linear in model windows (one per ~1.64 s of audio)
 *   post-processing  b     → 1      note decoding + clean-up, then 1 when the Score is ready
 * a and b are set when decoding ends, from the audio length and the measured cost of one window
 * (cold: an estimate), so each stage's share matches its expected share of the time.
 */
import type { ProgressFn } from '../../types';

export type AudioStage = 'reading' | 'decoding' | 'loading-model' | 'transcribing' | 'post-processing';

export const READ_END = 0.02;
export const DECODE_END = 0.06;

/** Typical costs (WebGL, Apple M-series, shaders already in the OS cache); measured values replace them once warm. */
export const DEFAULT_WINDOW_MS = 35;
export const COLD_MODEL_MS = 450;
const FINISH_BASE_MS = 15;
const FINISH_MS_PER_WINDOW = 0.6;

export interface ProgressPlanInput {
  /** Number of 2 s model windows (mono.ts modelWindows). */
  windows: number;
  /** Measured ms per window when warm, else null. */
  windowMs: number | null;
  /** Whether the model still has to load / compile before inference can start. */
  modelPending: boolean;
}

export interface Segments {
  modelEnd: number;
  inferEnd: number;
}

export function planSegments(p: ProgressPlanInput): Segments {
  const windowMs = p.windowMs ?? DEFAULT_WINDOW_MS;
  const model = p.modelPending ? COLD_MODEL_MS : 0;
  const infer = Math.max(1, p.windows) * windowMs;
  const finish = FINISH_BASE_MS + FINISH_MS_PER_WINDOW * p.windows;
  const total = model + infer + finish;
  const span = 1 - DECODE_END;
  const modelEnd = DECODE_END + (span * model) / total;
  const inferEnd = modelEnd + (span * infer) / total;
  return { modelEnd, inferEnd };
}

/** Maps stage events to a monotonic overall fraction and forwards it with the stage label. */
export class AudioProgress {
  private last = 0;
  private seg: Segments = { modelEnd: DECODE_END, inferEnd: 0.97 };

  constructor(private readonly emit: ProgressFn) {}

  private report(fraction: number, stage: AudioStage): void {
    const f = Math.min(1, Math.max(this.last, fraction));
    this.last = f;
    this.emit(f, stage);
  }

  reading(): void {
    this.report(0, 'reading');
  }

  decoding(): void {
    this.report(READ_END, 'decoding');
  }

  /** Call once decoding is done, when the audio length is known. */
  plan(input: ProgressPlanInput): void {
    this.seg = planSegments(input);
    this.report(DECODE_END, input.modelPending ? 'loading-model' : 'transcribing');
  }

  /** Worker stage progress, `value` = fraction of that stage (0–1). */
  worker(stage: 'loading-model' | 'transcribing' | 'finishing', value: number): void {
    const v = Math.min(1, Math.max(0, value));
    if (stage === 'loading-model') this.report(DECODE_END + (this.seg.modelEnd - DECODE_END) * v, 'loading-model');
    else if (stage === 'transcribing') this.report(this.seg.modelEnd + (this.seg.inferEnd - this.seg.modelEnd) * v, 'transcribing');
    else this.report(this.seg.inferEnd, 'post-processing');
  }

  done(): void {
    this.report(1, 'post-processing');
  }

  get fraction(): number {
    return this.last;
  }
}
