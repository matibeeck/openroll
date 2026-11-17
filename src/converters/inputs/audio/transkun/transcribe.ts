/**
 * Transkun inference loop over 16 s segments every 8 s, independent of onnxruntime (the worker and
 * Node tests pass in the two model graphs). Written from transkun 2.0.1 (MIT, © 2021 Yujia Yan):
 * `TransKun.transcribe`, `transcribeFrames`, `fetchIntervalFeaturesBatch` and `Data.resolveOverlapping`,
 * with the CLI defaults (velocity = argmax, `discardSecondHalf` off, `mergeIncompleteEvent` on).
 *
 * One deliberate difference: segments that lie entirely in the trailing zero padding are not run.
 * Their features are all zero; the model decodes no interval there (checked on the real model in
 * tests/roundtrip/transkun.test.ts), so the result is the same and long files save one segment.
 */
import { TK_ATTR, TK_CTX, TK_HOP, TK_SAMPLE_RATE, TK_SEGMENT_HOP_SECONDS, TK_SEGMENT_SECONDS, TK_SYMBOLS, TK_TRACKS } from './constants';

export { planSegments, type SegmentPlan } from './segments';
import { frameCount, TranskunFrontEnd } from './frontend';
import { planSegments, type SegmentPlan } from './segments';
import { viterbiBackward, type Interval } from './viterbi';

/** A decoded event: a note (symbol = MIDI pitch 21–108) or a pedal span (symbol −64 sustain, −67 soft). */
export interface TranskunEvent {
  start: number;
  end: number;
  symbol: number;
  /** MIDI velocity 0–127 (for pedals: the model's value of the CC). */
  velocity: number;
}

/** The two exported graphs (transkun.onnx and transkun-heads.onnx). */
export interface TranskunModel {
  /** featuresBatch [1, T, 229, 6] → S [T, T, 90], ctx [90, T, 256]. */
  main(features: Float32Array, frames: number): Promise<{ S: Float32Array; ctx: Float32Array }>;
  /** attr [n, 768] → velLogits [n, 128], ofRaw [n, 4]. */
  heads(attr: Float32Array, n: number): Promise<{ velLogits: Float32Array; ofRaw: Float32Array }>;
}

export class TranskunCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'TranskunCancelled';
  }
}

interface RawEvent {
  start: number;
  end: number;
  symbol: number;
  velocity: number;
  hasOnset: boolean;
  hasOffset: boolean;
}

/** float32 machine epsilon: torch clamps the probabilities to [ε, 1 − ε]. */
const F32_EPS = 1.1920928955078125e-7;

/** Mean of torch.distributions.ContinuousBernoulli(logits) (same clamping and unstable-region Taylor branch). */
export function continuousBernoulliMean(logit: number): number {
  const p = Math.min(1 - F32_EPS, Math.max(F32_EPS, 1 / (1 + Math.exp(-logit))));
  const outside = p <= 0.499 || p > 0.501;
  if (!outside) {
    const x = p - 0.5;
    return 0.5 + (1 / 3 + (16 / 45) * x * x) * x;
  }
  return p / (2 * p - 1) + 1 / (Math.log1p(-p) - Math.log(p));
}

/** Upstream `transcribeFrames` for one segment: intervals → events (segment-relative times). */
async function segmentEvents(
  model: TranskunModel,
  S: Float32Array,
  ctx: Float32Array,
  T: number,
  forcedStartPos: number[],
  lastFrameIdx: number,
): Promise<{ events: RawEvent[]; lastP: number[] }> {
  const path: Interval[][] = viterbiBackward(S, T, TK_TRACKS, forcedStartPos);
  const n = path.reduce((s, p) => s + p.length, 0);
  if (n === 0) return { events: [], lastP: new Array<number>(TK_TRACKS).fill(0) };

  // [ctx_a, ctx_b, ctx_a·ctx_b] per interval, ctx laid out [track, frame, 256].
  const attr = new Float32Array(n * TK_ATTR);
  let row = 0;
  for (let k = 0; k < TK_TRACKS; k++) {
    for (const [a, b] of path[k]!) {
      const ca = (k * T + a) * TK_CTX;
      const cb = (k * T + b) * TK_CTX;
      const o = row * TK_ATTR;
      for (let d = 0; d < TK_CTX; d++) {
        const x = ctx[ca + d]!;
        const y = ctx[cb + d]!;
        attr[o + d] = x;
        attr[o + TK_CTX + d] = y;
        attr[o + 2 * TK_CTX + d] = Math.fround(x * y);
      }
      row++;
    }
  }
  const { velLogits, ofRaw } = await model.heads(attr, n);

  const frameDur = TK_HOP / TK_SAMPLE_RATE;
  const events: RawEvent[] = [];
  const lastP: number[] = [];
  let idx = 0;
  for (let k = 0; k < TK_TRACKS; k++) {
    let lastEnd = 0;
    let curLastP = 0;
    for (const [a, b] of path[k]!) {
      let velocity = 0;
      for (let v = 1; v < 128; v++) if (velLogits[idx * 128 + v]! > velLogits[idx * 128 + velocity]!) velocity = v;
      const of = (j: number) => Math.min(0.5, Math.max(-0.5, (continuousBernoulliMean(ofRaw[idx * 4 + j]!) - 0.5) / 0.99));
      let start = (a + of(0)) * frameDur;
      let end = (b + of(1)) * frameDur;
      const hasOnset = a > 0 || ofRaw[idx * 4 + 2]! > 0;
      const hasOffset = b < lastFrameIdx || ofRaw[idx * 4 + 3]! > 0;
      start = Math.max(start, lastEnd);
      end = Math.max(end, start + 1e-8);
      lastEnd = end;
      events.push({ start, end, symbol: TK_SYMBOLS[k]!, velocity, hasOnset, hasOffset });
      if (hasOffset) curLastP = b;
      idx++;
    }
    lastP.push(curLastP);
  }
  events.sort(byStartEndSymbol);
  return { events, lastP };
}

function byStartEndSymbol(a: { start: number; end: number; symbol: number }, b: { start: number; end: number; symbol: number }) {
  return a.start - b.start || a.end - b.end || a.symbol - b.symbol;
}

/** Upstream `Data.resolveOverlapping`: a same-symbol event cuts the previous one; empty events go. */
export function resolveOverlapping<E extends { start: number; end: number; symbol: number }>(events: E[]): E[] {
  const sorted = [...events].sort(byStartEndSymbol);
  const lastOf = new Map<number, E>();
  for (const e of sorted) {
    const prev = lastOf.get(e.symbol);
    if (prev && prev.end > e.start) prev.end = e.start;
    lastOf.set(e.symbol, e);
  }
  return sorted.sort(byStartEndSymbol).filter((e) => e.start < e.end);
}

export interface TranscribeTranskunOptions {
  /** Called after each model segment (done, total). */
  onSegment?: (done: number, total: number) => void;
  /** Checked between segments; throw TranskunCancelled when true. */
  isCancelled?: () => boolean;
  /** Called with the plan before the first segment. */
  onPlan?: (plan: SegmentPlan) => void;
  /** Reusable front end (tables are built once). */
  frontEnd?: TranskunFrontEnd;
}

/**
 * Audio at 44,100 Hz (one array per channel, same length) → note and pedal events, in seconds.
 * The front end averages the channels' power spectra like upstream's `toMono`.
 */
export async function transcribeTranskun(
  channels: Float32Array[],
  model: TranskunModel,
  opts: TranscribeTranskunOptions = {},
): Promise<TranskunEvent[]> {
  const samples = channels[0]?.length ?? 0;
  const plan = planSegments(samples);
  opts.onPlan?.(plan);
  const fe = opts.frontEnd ?? new TranskunFrontEnd();
  const padTime = TK_SEGMENT_SECONDS - TK_SEGMENT_HOP_SECONDS;
  const stepFrames = Math.trunc(plan.stepSamples / TK_HOP);
  let startPos = new Array<number>(TK_TRACKS).fill(plan.startFrame);
  const byType = new Map<number, RawEvent[]>();
  const slice = channels.map(() => new Float32Array(plan.segmentSamples));

  for (let s = 0; s < plan.starts.length; s++) {
    if (opts.isCancelled?.()) throw new TranskunCancelled();
    const i = plan.starts[s]!;
    // Padded-signal samples [i, i + segment) → audio samples [i − pad, …), zeros outside.
    channels.forEach((x, c) => {
      const out = slice[c]!;
      out.fill(0);
      const from = i - plan.padSamples;
      const a = Math.max(0, from);
      const b = Math.min(samples, from + plan.segmentSamples);
      if (b > a) out.set(x.subarray(a, b), a - from);
    });
    const { data, frames } = fe.features(slice);
    if (frames !== frameCount(plan.segmentSamples)) throw new Error('unexpected frame count');
    // S and ctx (~230 MB for a 16 s segment) only live inside this call.
    const { events, lastP } = await model
      .main(data, frames)
      .then(({ S, ctx }) => segmentEvents(model, S, ctx, frames, startPos, plan.lastFrameIdx));
    startPos = lastP.map((p) => Math.max(p - stepFrames, 0));

    const beginTime = i / TK_SAMPLE_RATE - padTime;
    for (const e of events) {
      e.start = Math.max(e.start + beginTime, 0);
      e.end = Math.max(e.end + beginTime, e.start);
    }
    for (const e of events) {
      const list = byType.get(e.symbol) ?? [];
      byType.set(e.symbol, list);
      const last = list[list.length - 1];
      if (last && e.start < last.end) {
        if (e.hasOnset) list[list.length - 1] = e;
        else {
          last.hasOffset = e.hasOffset;
          last.end = Math.max(e.end, last.end);
        }
        continue;
      }
      if (e.hasOnset) list.push(e);
    }
    opts.onSegment?.(s + 1, plan.starts.length);
  }

  const all: RawEvent[] = [];
  for (const list of byType.values()) {
    if (list.length) list[list.length - 1]!.hasOffset = true;
    all.push(...list);
  }
  return resolveOverlapping(all.filter((e) => e.hasOffset)).map(({ start, end, symbol, velocity }) => ({ start, end, symbol, velocity }));
}
