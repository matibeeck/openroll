/**
 * Tempo, meter and downbeat estimation from note onsets, for free-timing scores (recordings,
 * transcriptions). Pure functions: seconds in, seconds out.
 *
 * 1. Onsets are grouped into events (chords) with a salience: loudness, chord size, a new bass
 *    note, and durational accent (long notes and long gaps after them sound stressed).
 * 2. The autocorrelation of a smoothed salience curve gives a pulse period; dynamic-programming
 *    beat tracking (Ellis 2007) follows that pulse through rubato, in two passes (the second
 *    with the locally measured period).
 * 3. Every meter hypothesis (2/4, 3/4, 4/4, 6/8, 9/8, 12/8) × pulse level (the tracked pulse,
 *    its halves/thirds, or every 2nd/3rd pulse) × downbeat phase is scored with a small
 *    generative model: each metrical position (downbeat, beat, pulse, half-pulse) has its own
 *    probability of holding an onset and its own expected accent, so 6/8 (stress on pulses 0
 *    and 3) and 3/4 (0, 2, 4) differ even when every eighth is played. Priors on the beat
 *    period (≈ 80 BPM) and on common meters break near-ties.
 */
import type { Note, TimeSignature } from './score';

export interface MeterShape {
  /** Pulses per beat: 2 (simple) or 3 (compound). */
  group: number;
  /** Beats per bar. */
  beats: number;
  /** Quarter notes per pulse (0.5 = eighth). */
  pulseQuarters: number;
}

export interface MeterEstimate {
  timeSignature: TimeSignature;
  /** Beats per minute in the meter's beat unit (dotted quarter in 6/8, 9/8, 12/8). */
  beatBpm: number;
  /** Quarter notes per minute (the Score/MIDI convention). */
  bpm: number;
  /**
   * Tracked pulse times in seconds (the beat's subdivision: eighths in 4/4 and 6/8).
   * pulses[0] is a downbeat at or before the first onset; the list extends past the last note.
   */
  pulses: number[];
  pulseQuarters: number;
  pulsesPerBar: number;
  /** Log-likelihood margin over the best hypothesis with another meter (≥ 0). */
  confidence: number;
}

export interface EstimateMeterOptions {
  /** Only consider this meter. */
  timeSignature?: TimeSignature;
  /**
   * Use exactly this tempo (beats per minute in the meter's beat unit) instead of tracking the
   * playing; only the phase and the downbeat are estimated.
   */
  beatBpm?: number;
}

/** Meters proposed by the estimator, with log priors per 4 s of music (4/4 most common). */
export const CANDIDATE_METERS: { ts: TimeSignature; prior: number }[] = [
  { ts: { numerator: 4, denominator: 4 }, prior: 0 },
  { ts: { numerator: 3, denominator: 4 }, prior: -0.3 },
  { ts: { numerator: 2, denominator: 4 }, prior: -0.6 },
  { ts: { numerator: 6, denominator: 8 }, prior: -0.3 },
  { ts: { numerator: 9, denominator: 8 }, prior: -1.2 },
  { ts: { numerator: 12, denominator: 8 }, prior: -0.8 },
];

/** Compound meters (6/8, 9/8, 12/8…) group pulses in threes. */
export function meterShape(ts: TimeSignature): MeterShape {
  const unit = 4 / ts.denominator;
  if (ts.denominator >= 8 && ts.numerator % 3 === 0 && ts.numerator > 3) {
    return { group: 3, beats: ts.numerator / 3, pulseQuarters: unit };
  }
  return { group: 2, beats: ts.numerator, pulseQuarters: unit / 2 };
}

/** Quarter notes per beat of a meter (1.5 in 6/8, 1 in 4/4, 0.5 in 3/8). */
export function beatQuarters(ts: TimeSignature): number {
  const s = meterShape(ts);
  return s.group * s.pulseQuarters;
}

// ---------------------------------------------------------------- events and salience

export interface OnsetEvent {
  time: number;
  /** Standardized accent (z-score over the piece). */
  accent: number;
  /** Raw positive salience. */
  salience: number;
}

const EVENT_TOLERANCE = 0.05;

/** Group onsets into events and give each an accent. */
export function onsetEvents(notes: Pick<Note, 'pitch' | 'start' | 'duration' | 'velocity'>[]): OnsetEvent[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const groups: (typeof sorted)[] = [];
  for (const n of sorted) {
    const g = groups[groups.length - 1];
    if (g && n.start - g[g.length - 1]!.start <= EVENT_TOLERANCE) g.push(n);
    else groups.push([n]);
  }
  if (groups.length === 0) return [];
  const times = groups.map((g) => g.reduce((s, n) => s + n.start, 0) / g.length);
  const iois = times.slice(1).map((t, i) => t - times[i]!);
  const medIoi = Math.max(0.05, median(iois.length ? iois : [0.5]));
  const lows = groups.map((g) => Math.min(...g.map((n) => n.pitch)));

  const raw = groups.map((g, i) => {
    const t = times[i]!;
    const maxVel = Math.max(...g.map((n) => n.velocity));
    const maxDur = Math.max(...g.map((n) => n.duration));
    const ioiNext = i + 1 < times.length ? times[i + 1]! - t : maxDur;
    // A new bass note: the lowest pitch within ±1 s and in the lower half of the keyboard.
    let localLow = Infinity;
    for (let j = i; j >= 0 && t - times[j]! <= 1; j--) localLow = Math.min(localLow, lows[j]!);
    for (let j = i; j < times.length && times[j]! - t <= 1; j++) localLow = Math.min(localLow, lows[j]!);
    const bass = lows[i]! <= localLow && lows[i]! < 60 ? 1 : 0;
    const durAccent = Math.log2(1 + Math.min(maxDur, 4 * medIoi) / medIoi);
    const gapAccent = Math.log2(1 + Math.min(ioiNext, 4 * medIoi) / medIoi);
    return 0.3 + maxVel + 0.4 * Math.log2(g.length) + 0.8 * bass + 0.5 * durAccent + 0.5 * gapAccent;
  });
  const mean = raw.reduce((s, x) => s + x, 0) / raw.length;
  const sd = Math.sqrt(raw.reduce((s, x) => s + (x - mean) ** 2, 0) / raw.length);
  return raw.map((s, i) => ({ time: times[i]!, salience: s, accent: sd > 1e-6 ? (s - mean) / sd : 0 }));
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

// ---------------------------------------------------------------- pulse period and tracking

const HOP = 0.01;
const SMOOTH = 0.02;

/** Salience curve sampled every HOP seconds from `origin`, Gaussian-smoothed onsets. */
function envelope(events: OnsetEvent[], origin: number, frames: number): Float64Array {
  const env = new Float64Array(frames);
  const meanSal = events.reduce((s, e) => s + e.salience, 0) / Math.max(1, events.length);
  const reach = Math.ceil((3 * SMOOTH) / HOP);
  for (const e of events) {
    const c = (e.time - origin) / HOP;
    const w = e.salience / meanSal;
    for (let f = Math.max(0, Math.floor(c) - reach); f <= Math.min(frames - 1, Math.ceil(c) + reach); f++) {
      const d = ((f - c) * HOP) / SMOOTH;
      env[f]! += w * Math.exp(-0.5 * d * d);
    }
  }
  return env;
}

/** Best pulse period (s) by autocorrelation, with a mild preference for ≈ 0.3 s. */
export function pulsePeriod(events: OnsetEvent[]): number {
  if (events.length < 3) return 0.5;
  const origin = events[0]!.time - 0.1;
  const frames = Math.ceil((events[events.length - 1]!.time - origin + 0.2) / HOP);
  const env = envelope(events, origin, frames);
  const minLag = Math.round(0.1 / HOP);
  const maxLag = Math.min(frames - 1, Math.round(1.2 / HOP));
  const acf: number[] = [];
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let f = 0; f + lag < frames; f++) s += env[f]! * env[f + lag]!;
    acf.push(s / Math.max(1, frames - lag));
  }
  let best = { lag: Math.round(0.5 / HOP), score: -Infinity };
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (acf[lag]! < acf[lag - 1]! || acf[lag]! < acf[lag + 1]!) continue;
    const prior = Math.exp(-0.5 * Math.log2((lag * HOP) / 0.3) ** 2);
    const score = acf[lag]! * prior;
    if (score > best.score) best = { lag, score };
  }
  // Parabolic refinement of the peak.
  const { lag } = best;
  const a = acf[lag - 1] ?? 0;
  const b = acf[lag] ?? 0;
  const c = acf[lag + 1] ?? 0;
  const den = a - 2 * b + c;
  const shift = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
  return (lag + shift) * HOP;
}

/**
 * A constant pulse at exactly `period` seconds (a tempo the user typed), phased to sit on the
 * onsets as well as possible; spans the events with one pulse of margin on each side.
 */
export function constantPulses(events: OnsetEvent[], period: number): number[] {
  if (events.length === 0) return [];
  let best = { offset: 0, score: -Infinity };
  for (let o = 0; o < period; o += 0.005) {
    let sc = 0;
    for (const e of events) {
      const r = (((e.time - o) % period) + period) % period;
      const d = Math.min(r, period - r);
      sc += e.salience * Math.exp(-0.5 * (d / 0.03) ** 2);
    }
    if (sc > best.score) best = { offset: o, score: sc };
  }
  const first = events[0]!.time;
  const last = events[events.length - 1]!.time;
  const out: number[] = [];
  for (let k = Math.floor((first - best.offset) / period) - 1; best.offset + k * period <= last + period; k++) out.push(best.offset + k * period);
  return out;
}

/** Penalty weight for deviating from the expected period, per pulse. */
const TIGHTNESS = 40;

/**
 * Dynamic-programming beat tracking over the salience curve: pulse frames that hit strong
 * onsets while keeping each interval close to the local period `period(f)` (in frames).
 */
function dpTrack(env: Float64Array, period: (f: number) => number, slack = 0.4): number[] {
  const n = env.length;
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  for (let f = 0; f < n; f++) {
    const T = period(f);
    const lo = Math.max(1, Math.floor(T / (1 + slack)));
    const hi = Math.ceil(T * (1 + slack));
    let best = f < hi ? 0 : -Infinity;
    let arg = -1;
    for (let p = Math.max(0, f - hi); p <= f - lo; p++) {
      const v = score[p]! - TIGHTNESS * Math.log((f - p) / T) ** 2;
      if (v > best) {
        best = v;
        arg = p;
      }
    }
    score[f] = env[f]! + best;
    back[f] = arg;
  }
  // End anywhere in the last period.
  const lastT = period(n - 1);
  let end = n - 1;
  for (let f = Math.max(0, n - Math.ceil(lastT)); f < n; f++) if (score[f]! > score[end]!) end = f;
  const out: number[] = [];
  for (let f = end; f >= 0; f = back[f]!) {
    out.push(f);
    if (back[f]! < 0) break;
  }
  return out.reverse();
}

/** Pulse times (s) tracked at about `period` seconds, snapped to nearby onsets. */
export function trackPulses(events: OnsetEvent[], period: number): number[] {
  if (events.length === 0) return [];
  const origin = events[0]!.time - period;
  const frames = Math.ceil((events[events.length - 1]!.time - origin + period) / HOP) + 1;
  const env = envelope(events, origin, frames);
  const T0 = period / HOP;
  const slack = 0.4;
  let frameList = dpTrack(env, () => T0, slack);
  // Second pass with the locally measured period (smoothed over ±4 pulses), for rubato.
  if (frameList.length >= 4) {
    const ints = frameList.slice(1).map((f, i) => f - frameList[i]!);
    const local = ints.map((_, i) => median(ints.slice(Math.max(0, i - 4), i + 5)));
    const at = (f: number) => {
      let k = 0;
      while (k + 1 < frameList.length - 1 && frameList[k + 1]! <= f) k++;
      return Math.max(T0 / (1 + 1.5 * slack), Math.min(T0 * (1 + 1.5 * slack), local[Math.min(k, local.length - 1)]!));
    };
    const table = Array.from({ length: frames }, (_, f) => at(f));
    frameList = dpTrack(env, (f) => table[f]!, slack);
  }
  const times = frameList.map((f) => origin + f * HOP);
  // Snap each pulse to the most salient onset within 40 ms.
  let j = 0;
  return times.map((t) => {
    while (j < events.length && events[j]!.time < t - 0.04) j++;
    let best: OnsetEvent | null = null;
    for (let k = j; k < events.length && events[k]!.time <= t + 0.04; k++) {
      if (!best || events[k]!.salience > best.salience) best = events[k]!;
    }
    return best ? best.time : t;
  });
}

// ---------------------------------------------------------------- hypothesis scoring

/**
 * Probability that a metrical position holds an onset, and the accent expected there.
 * `quarter` = a quarter of a pulse (e.g. 32nds), `other` = any slot that is not on the
 * hypothesis' grid (e.g. a triplet position in simple meter).
 */
const LEVELS = {
  downbeat: { p: 0.9, mu: 1.3 },
  strong: { p: 0.85, mu: 0.9 },
  beat: { p: 0.75, mu: 0.35 },
  pulse: { p: 0.5, mu: -0.2 },
  half: { p: 0.2, mu: -0.5 },
  quarter: { p: 0.05, mu: -0.6 },
  other: { p: 0.02, mu: -0.6 },
} as const;
type Level = keyof typeof LEVELS;
/** Precomputed log p / log (1 − p) per level. */
const LOGS = Object.fromEntries(
  Object.entries(LEVELS).map(([k, v]) => [k, { hit: Math.log(v.p), miss: Math.log(1 - v.p), mu: v.mu }]),
) as Record<Level, { hit: number; miss: number; mu: number }>;

function levelOf(posInBar: number, shape: MeterShape): Level {
  if (posInBar === 0) return 'downbeat';
  if (posInBar % shape.group !== 0) return 'pulse';
  const beat = posInBar / shape.group;
  return shape.beats === 4 && beat === 2 ? 'strong' : 'beat';
}

/** log N(z; mu, 1) − log N(z; 0, 1): how much an accent of z supports a level. */
function accentLL(z: number, mu: number): number {
  return z * mu - (mu * mu) / 2;
}

/** Fractional pulse index of time t (linear inside, extrapolated outside). */
export function pulseIndex(times: number[], t: number): number {
  const n = times.length;
  if (n < 2) return 0;
  if (t <= times[0]!) return (t - times[0]!) / (times[1]! - times[0]!);
  if (t >= times[n - 1]!) return n - 1 + (t - times[n - 1]!) / (times[n - 1]! - times[n - 2]!);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= t) lo = mid;
    else hi = mid;
  }
  return lo + (t - times[lo]!) / (times[hi]! - times[lo]!);
}

/** Time at fractional pulse index x (inverse of pulseIndex). */
export function pulseTime(times: number[], x: number): number {
  const n = times.length;
  if (n === 1) return times[0]!;
  if (x <= 0) return times[0]! + x * (times[1]! - times[0]!);
  if (x >= n - 1) return times[n - 1]! + (x - n + 1) * (times[n - 1]! - times[n - 2]!);
  const k = Math.floor(x);
  return times[k]! + (x - k) * (times[k + 1]! - times[k]!);
}

/**
 * Every hypothesis is scored on the same slots — the tracked pulse divided into SLOTS — so a
 * coarse pulse (fewer positions, events on its subdivisions) and a fine one (more positions,
 * many of them empty) compete fairly. Pulse ratios: the hypothesis pulse is RATIOS[i] tracked pulses.
 */
const SLOTS = 6;
const RATIOS = [1, 2, 3, 1 / 2, 1 / 3];

export interface SlotEvidence {
  /** Max accent of the events on each slot (NaN = none), from slot `first`. */
  accent: Float64Array;
  first: number;
}

export function slotEvidence(base: number[], events: OnsetEvent[]): SlotEvidence {
  const slots = events.map((e) => Math.round(pulseIndex(base, e.time) * SLOTS));
  const first = Math.min(...slots);
  const accent = new Float64Array(Math.max(...slots) - first + 1).fill(NaN);
  slots.forEach((s, i) => {
    const k = s - first;
    const z = events[i]!.accent;
    accent[k] = Number.isNaN(accent[k]!) ? z : Math.max(accent[k]!, z);
  });
  return { accent, first };
}

/** Level of each slot offset within one bar of a hypothesis. */
function barLevels(shape: MeterShape, pulseSlots: number): Level[] {
  const bar = shape.group * shape.beats * pulseSlots;
  return Array.from({ length: bar }, (_, d): Level => {
    if (d % pulseSlots === 0) return levelOf(d / pulseSlots, shape);
    if ((2 * d) % pulseSlots === 0) return 'half';
    if ((4 * d) % pulseSlots === 0) return 'quarter';
    return 'other';
  });
}

function slotLL(z: number, lv: Level): number {
  const L = LOGS[lv];
  return Number.isNaN(z) ? L.miss : L.hit + accentLL(z, L.mu);
}

/** Cost of a pickup as long as a whole bar (scaled by the fraction of the bar before the first onset). */
const PICKUP = 4;

/** Cost of re-synchronizing the bar (the tracker gained or lost a pulse in rubato). */
const PHASE_JUMP = 4;

export interface PhasePath {
  ll: number;
  /** Downbeat phase (slot mod bar) in force at each evidence slot. */
  phases: Int32Array;
}

/**
 * Viterbi over the downbeat phase: the phase may jump by one pulse (or one tracked pulse) at
 * tracked-pulse boundaries, at a cost, so a bar grid survives a pulse that the tracker added
 * or dropped during rubato.
 */
export function phaseViterbi(ev: SlotEvidence, shape: MeterShape, pulseSlots: number): PhasePath {
  const levels = barLevels(shape, pulseSlots);
  const bar = levels.length;
  const jumps = [...new Set([pulseSlots, SLOTS])].filter((j) => j < bar);
  const n = ev.accent.length;
  // Prior on the pickup: the first onset is more likely early in its bar (a downbeat start or a
  // short anacrusis), so ambiguous evidence does not open with a bar of rests.
  let dp = Float64Array.from({ length: bar }, (_, ph) => (-PICKUP * ((((ev.first - ph) % bar) + bar) % bar)) / bar);
  const backs: { slot: number; from: Int32Array }[] = [];
  for (let k = 0; k < n; k++) {
    const s = ev.first + k;
    if (k > 0 && ((s % SLOTS) + SLOTS) % SLOTS === 0 && jumps.length) {
      const next = new Float64Array(bar);
      const from = new Int32Array(bar);
      for (let ph = 0; ph < bar; ph++) {
        let best = dp[ph]!;
        let arg = ph;
        for (const j of jumps) {
          for (const q of [(ph + j) % bar, (ph - j + bar) % bar]) {
            const v = dp[q]! - PHASE_JUMP;
            if (v > best) {
              best = v;
              arg = q;
            }
          }
        }
        next[ph] = best;
        from[ph] = arg;
      }
      dp = next;
      backs.push({ slot: k, from });
    }
    const z = ev.accent[k]!;
    for (let ph = 0; ph < bar; ph++) dp[ph]! += slotLL(z, levels[(((s - ph) % bar) + bar) % bar]!);
  }
  let end = 0;
  for (let ph = 1; ph < bar; ph++) if (dp[ph]! > dp[end]!) end = ph;
  const phases = new Int32Array(n);
  let ph = end;
  let b = backs.length - 1;
  for (let k = n - 1; k >= 0; k--) {
    phases[k] = ph;
    if (b >= 0 && backs[b]!.slot === k) {
      ph = backs[b]!.from[ph]!;
      b--;
    }
  }
  return { ll: dp[end]!, phases };
}

/**
 * Log prior on the beat period per second of music (most music is felt at 60–120 beats per
 * minute). Applied per second, like a tempo term in an HMM, so it keeps its weight against the
 * evidence on long pieces: one octave away from 0.75 s costs ≈ 1.3 per second.
 */
export function tempoPrior(beatSeconds: number, seconds: number): number {
  return -0.5 * (Math.log2(beatSeconds / 0.75) / 0.5) ** 2 * (seconds / 1.5);
}

const cache = new WeakMap<object, Map<string, MeterEstimate>>();

/**
 * Estimate tempo, meter and downbeat phase from note onsets. Returns null when there are too
 * few onsets to say anything (fewer than 4 events).
 * Results are cached per `notes` array and options.
 */
export function estimateMeter(
  notes: Pick<Note, 'pitch' | 'start' | 'duration' | 'velocity'>[],
  opts: EstimateMeterOptions = {},
): MeterEstimate | null {
  const key = `${opts.timeSignature ? `${opts.timeSignature.numerator}/${opts.timeSignature.denominator}` : '*'}@${opts.beatBpm ?? '*'}`;
  const hit = cache.get(notes)?.get(key);
  if (hit) return hit;
  const result = estimateUncached(notes, opts);
  if (result) {
    const m = cache.get(notes) ?? new Map<string, MeterEstimate>();
    m.set(key, result);
    cache.set(notes, m);
  }
  return result;
}

interface Hypothesis {
  ll: number;
  base: number[];
  ev: SlotEvidence;
  pulseSlots: number;
  path: PhasePath;
  ts: TimeSignature;
  shape: MeterShape;
}

function estimateUncached(
  notes: Pick<Note, 'pitch' | 'start' | 'duration' | 'velocity'>[],
  opts: EstimateMeterOptions,
): MeterEstimate | null {
  const events = onsetEvents(notes);
  if (events.length < 4) return null;
  const meters = opts.timeSignature ? [{ ts: opts.timeSignature, prior: 0 }] : CANDIDATE_METERS;
  const span = Math.max(1, events[events.length - 1]!.time - events[0]!.time);

  // Tracked pulse: with a user tempo, the pulse of each meter at that tempo (no other ratios).
  const bases = new Map<number, { base: number[]; ev: SlotEvidence; period: number }>();
  const baseFor = (shape: MeterShape) => {
    const period = opts.beatBpm ? 60 / opts.beatBpm / shape.group : pulsePeriod(events);
    const key = Math.round(period * 1e4);
    let b = bases.get(key);
    if (!b) {
      // A typed tempo is followed exactly; the estimate follows the playing (rubato).
      const base = opts.beatBpm ? constantPulses(events, period) : trackPulses(events, period);
      if (base.length < 2) return null;
      const measured = median(base.slice(1).map((t, i) => t - base[i]!));
      b = { base, ev: slotEvidence(base, events), period: measured };
      bases.set(key, b);
    }
    return b;
  };

  const bestPerMeter: Hypothesis[] = [];
  for (const m of meters) {
    const shape = meterShape(m.ts);
    const b = baseFor(shape);
    if (!b) continue;
    let best: Hypothesis | null = null;
    for (const ratio of opts.beatBpm ? [1] : RATIOS) {
      const pulseSlots = Math.round(ratio * SLOTS);
      const period = b.period * ratio;
      if (!opts.beatBpm && (period < 0.07 || period > 1.0)) continue;
      const prior = m.prior * Math.max(1, span / 4) + (opts.beatBpm ? 0 : tempoPrior(period * shape.group, span));
      const path = phaseViterbi(b.ev, shape, pulseSlots);
      const ll = path.ll + prior;
      if (!best || ll > best.ll) best = { ll, base: b.base, ev: b.ev, pulseSlots, path, ts: m.ts, shape };
    }
    if (best) bestPerMeter.push(best);
  }
  if (bestPerMeter.length === 0) return null;
  bestPerMeter.sort((a, b) => b.ll - a.ll);
  const win = bestPerMeter[0]!;
  const confidence = bestPerMeter.length > 1 ? win.ll - bestPerMeter[1]!.ll : Infinity;
  const pulses = pulsesFromPath(win, notes);
  const period = median(pulses.slice(1).map((t, i) => t - pulses[i]!));
  return {
    timeSignature: win.ts,
    beatBpm: 60 / (period * win.shape.group),
    bpm: (60 / period) * win.shape.pulseQuarters,
    pulses,
    pulseQuarters: win.shape.pulseQuarters,
    pulsesPerBar: win.shape.group * win.shape.beats,
    confidence,
  };
}

/**
 * Metrical pulse times from the phase path: one pulse per metrical index, starting at a
 * downbeat at or before the first onset and running past the last note's end. Where the phase
 * jumped, a duplicate pulse is dropped or a missing one interpolated.
 */
function pulsesFromPath(h: Hypothesis, notes: Pick<Note, 'start' | 'duration'>[]): number[] {
  const { ev, pulseSlots, path, base } = h;
  const N = h.shape.group * h.shape.beats;
  const n = ev.accent.length;
  // Metrical index (in pulses, downbeats at multiples of N) → slot position, inside the evidence.
  const bySlot = new Map<number, number>();
  for (let k = 0; k < n; k++) {
    const s = ev.first + k;
    const d = s - path.phases[k]!;
    if (((d % pulseSlots) + pulseSlots) % pulseSlots !== 0) continue;
    const m = d / pulseSlots;
    if (!bySlot.has(m)) bySlot.set(m, s);
  }
  const idx = [...bySlot.keys()].sort((a, b) => a - b);
  const slotTime = (s: number) => pulseTime(base, s / SLOTS);
  // Extend with the edge phases: before the evidence with the first phase, after it with the last.
  const firstPhase = path.phases[0]!;
  const lastPhase = path.phases[n - 1]!;
  const known = new Map<number, number>(idx.map((m) => [m, slotTime(bySlot.get(m)!)]));
  const timeOf = (m: number): number => {
    const t = known.get(m);
    if (t !== undefined) return t;
    if (idx.length === 0 || m < idx[0]!) return slotTime(m * pulseSlots + firstPhase);
    if (m > idx[idx.length - 1]!) return slotTime(m * pulseSlots + lastPhase);
    // Interpolate a pulse lost at a phase jump.
    let lo = m - 1;
    while (!known.has(lo)) lo--;
    let hi = m + 1;
    while (!known.has(hi)) hi++;
    return known.get(lo)! + ((known.get(hi)! - known.get(lo)!) * (m - lo)) / (hi - lo);
  };
  const firstOnset = slotTime(ev.first);
  const startOf = (m: number) => Math.floor(m / N) * N;
  let m0 = startOf(idx[0] ?? Math.floor((ev.first - firstPhase) / pulseSlots));
  while (timeOf(m0) > firstOnset + 0.25 * (timeOf(m0 + 1) - timeOf(m0))) m0 -= N;
  while (timeOf(m0 + N) <= firstOnset + 0.25 * (timeOf(m0 + N + 1) - timeOf(m0 + N))) m0 += N;
  const lastEnd = notes.reduce((mx, x) => Math.max(mx, x.start + x.duration), 0);
  const pulses: number[] = [];
  for (let m = m0; pulses.length < N + 1 || pulses[pulses.length - 1]! < lastEnd; m++) pulses.push(timeOf(m));
  for (let i = 0; i < N; i++) pulses.push(timeOf(m0 + pulses.length));
  // Guard against non-increasing times after a jump.
  for (let i = 1; i < pulses.length; i++) if (pulses[i]! <= pulses[i - 1]! + 1e-3) pulses[i] = pulses[i - 1]! + 1e-3;
  return pulses;
}
