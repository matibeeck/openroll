/**
 * Stage timings of an audio / performance-video conversion, recorded as User Timing measures
 * (`performance.getEntriesByType('measure')`, names `openroll:audio:<stage>`), so DevTools and
 * scripts/real-check can read the breakdown. No console output, no network.
 *
 * Times cross the worker boundary as epoch milliseconds (timeOrigin + now), which both sides share.
 */
export type TimingStage =
  | 'total'
  | 'file-read'
  | 'decode'
  | 'resample'
  | 'downmix'
  | 'wait-model'
  | 'backend'
  | 'model-load'
  | 'warmup'
  | 'inference'
  | 'decode-notes'
  | 'postprocess';

export interface TimingSpan {
  stage: TimingStage;
  /** Epoch ms (performance.timeOrigin + performance.now()). */
  start: number;
  end: number;
}

export function epochNow(): number {
  return performance.timeOrigin + performance.now();
}

/** Records a span as a User Timing measure on the current thread. Never throws. */
export function recordSpan(span: TimingSpan, detail?: Record<string, unknown>): void {
  try {
    const origin = performance.timeOrigin;
    performance.measure(`openroll:audio:${span.stage}`, {
      start: Math.max(0, span.start - origin),
      end: Math.max(0, span.end - origin),
      detail,
    });
  } catch {
    // User Timing unavailable (old browsers): timings are diagnostics only.
  }
}

/** Times `fn` and records it under `stage`. */
export async function timed<T>(stage: TimingStage, fn: () => Promise<T> | T): Promise<T> {
  const start = epochNow();
  try {
    return await fn();
  } finally {
    recordSpan({ stage, start, end: epochNow() });
  }
}
