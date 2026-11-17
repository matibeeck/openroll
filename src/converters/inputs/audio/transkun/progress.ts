/**
 * Progress of a high-precision conversion: one monotonic fraction + stage label, with stage shares
 * from expected durations so the UI's ETA (elapsed × (1 − f) / f) stays meaningful. Pure, no DOM.
 *
 *   reading / decoding      0 → 0.06          (same as the fast mode)
 *   downloading-model       → a               only the first time (bytes / assumed bandwidth)
 *   loading-model           → b               WebGPU / WebAssembly session set-up, once per page
 *   transcribing            → c               one step per 16 s segment
 *   post-processing         → 1
 * The download label carries the megabytes: `downloading-model:<done>:<total>` (whole MB).
 */
import type { ProgressFn } from '../../../types';
import { DECODE_END, READ_END } from '../progress';
import type { TranskunStage } from './protocol';

/** Assumed download speed for the first use (bytes/s); only shapes the bar, the bytes are exact. */
const ASSUMED_BANDWIDTH = 8e6;
const LOAD_MS = 2500;
const SEGMENT_MS_GPU = 2000;
const SEGMENT_MS_CPU = 9000;
const FINISH_MS = 300;

export interface TranskunPlanInput {
  segments: number;
  /** Bytes still to download (0 when cached or already loaded). */
  downloadBytes: number;
  /** Session already loaded in a warm worker. */
  warm: boolean;
  /** WebGPU available (faster segments). */
  gpu: boolean;
}

export class TranskunProgress {
  private last = 0;
  private bounds = { download: DECODE_END, load: DECODE_END, infer: 0.97 };

  constructor(private readonly emit: ProgressFn) {}

  private report(f: number, label: string): void {
    this.last = Math.min(1, Math.max(this.last, f));
    this.emit(this.last, label);
  }

  reading(): void {
    this.report(0, 'reading');
  }

  decoding(): void {
    this.report(READ_END, 'decoding');
  }

  plan(p: TranskunPlanInput): void {
    const download = (p.downloadBytes / ASSUMED_BANDWIDTH) * 1000;
    const load = p.warm ? 0 : LOAD_MS;
    const infer = Math.max(1, p.segments) * (p.gpu ? SEGMENT_MS_GPU : SEGMENT_MS_CPU);
    const total = download + load + infer + FINISH_MS;
    const span = 1 - DECODE_END;
    const d = DECODE_END + (span * download) / total;
    const l = d + (span * load) / total;
    this.bounds = { download: d, load: l, infer: l + (span * infer) / total };
    this.report(DECODE_END, p.warm ? 'transcribing' : 'loading-model');
  }

  worker(stage: TranskunStage, value: number, done?: number, total?: number): void {
    const v = Math.min(1, Math.max(0, value));
    const b = this.bounds;
    if (stage === 'downloading-model') {
      // Already cached: the bytes come from the service worker in a moment, so it is just "loading".
      if (b.download === DECODE_END) return this.report(DECODE_END, 'loading-model');
      const mb = (x?: number) => Math.round((x ?? 0) / 1e6);
      this.report(DECODE_END + (b.download - DECODE_END) * v, `downloading-model:${mb(done)}:${mb(total)}`);
    } else if (stage === 'loading-model') this.report(b.download + (b.load - b.download) * v, 'loading-model');
    else if (stage === 'transcribing') this.report(b.load + (b.infer - b.load) * v, 'transcribing');
    else this.report(b.infer, 'post-processing');
  }

  done(): void {
    this.report(1, 'post-processing');
  }

  get fraction(): number {
    return this.last;
  }
}
