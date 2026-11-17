/**
 * Quantization: Score (seconds) → notes on a beat grid, ready for notation.
 * Pure functions only. Ticks here are grid ticks: `divisions` per quarter note.
 *
 * Rules: snap onsets to the grid; notes whose onsets lie within `chordTolerance` of each other
 * form one chord and snap together; drop notes shorter than `minDuration`; never invent notes.
 */
import type { Hand, KeySignature, Note, Score, TempoEvent, TimeSignature } from './score';
import { normalizeTempos, secondsToBeats } from './tempo';

export interface QuantizeOptions {
  /** Use this constant tempo instead of the Score's tempo map (free-timing input). */
  bpm?: number;
  /** With `bpm`: shift time so the first note starts on beat 1. Default true when `bpm` is set. */
  alignFirstNote?: boolean;
  timeSignature?: TimeSignature;
  /** Grid ticks per quarter note: 4 = 1/16 (default), 2 = 1/8, 8 = 1/32. */
  divisions?: number;
  /** Onsets closer than this (seconds) are one chord. Default 0.035. */
  chordTolerance?: number;
  /** Notes shorter than this many grid steps are dropped as noise. Default 0.25. */
  minDuration?: number;
  /** Pitch split for notes without a hand. Default 60 (C4). */
  splitPitch?: number;
  key?: KeySignature;
}

export interface QNote {
  pitch: number;
  /** Grid ticks from the start. */
  start: number;
  /** Grid ticks, ≥ 1. */
  duration: number;
  hand: 'L' | 'R';
  velocity: number;
}

export interface QTempo {
  tick: number;
  bpm: number;
}

export interface QuantizedScore {
  title: string;
  divisions: number;
  timeSignature: TimeSignature;
  key: KeySignature;
  tempos: QTempo[];
  /** Sorted by start, then pitch. */
  notes: QNote[];
  measureTicks: number;
  /** Notes dropped as too short. */
  dropped: number;
}

export function measureTicks(ts: TimeSignature, divisions: number): number {
  return Math.max(1, Math.round((ts.numerator * 4 * divisions) / ts.denominator));
}

/** Hand for notation: the note's own hand, else a pitch split. */
export function staffHand(hand: Hand, pitch: number, splitPitch = 60): 'L' | 'R' {
  return hand ?? (pitch >= splitPitch ? 'R' : 'L');
}

/** Group onsets (seconds, sorted) into clusters whose consecutive gaps are ≤ tol. */
export function clusterOnsets(onsets: number[], tol: number): number[][] {
  const groups: number[][] = [];
  for (let i = 0; i < onsets.length; i++) {
    const last = groups[groups.length - 1];
    if (last && onsets[i]! - onsets[last[last.length - 1]!]! <= tol) last.push(i);
    else groups.push([i]);
  }
  return groups;
}

export function quantize(score: Score, opts: QuantizeOptions = {}): QuantizedScore {
  const divisions = opts.divisions ?? 4;
  const chordTol = opts.chordTolerance ?? 0.035;
  const minDur = opts.minDuration ?? 0.25;
  const splitPitch = opts.splitPitch ?? 60;
  const timeSignature = opts.timeSignature ?? score.timeSignature;

  let tempoMap: TempoEvent[];
  let offset = 0;
  if (opts.bpm && opts.bpm > 0) {
    tempoMap = [{ time: 0, bpm: opts.bpm }];
    const first = score.notes.reduce((m, n) => Math.min(m, n.start), Infinity);
    if ((opts.alignFirstNote ?? true) && Number.isFinite(first)) offset = first;
  } else {
    tempoMap = normalizeTempos(score.tempos);
  }
  const toBeats = (s: number) => secondsToBeats(tempoMap, Math.max(0, s - offset));

  // Drop micro-notes (measured in grid steps at their position) before anything else.
  let dropped = 0;
  const kept: Note[] = [];
  for (const n of score.notes) {
    const steps = (toBeats(n.start + n.duration) - toBeats(n.start)) * divisions;
    if (steps < minDur) dropped++;
    else kept.push(n);
  }
  kept.sort((a, b) => a.start - b.start || a.pitch - b.pitch);

  // Chord tones snap together: each cluster snaps to the grid point nearest its mean onset.
  const startTick = new Array<number>(kept.length);
  for (const group of clusterOnsets(
    kept.map((n) => n.start),
    chordTol,
  )) {
    const mean = group.reduce((s, i) => s + toBeats(kept[i]!.start), 0) / group.length;
    const tick = Math.max(0, Math.round(mean * divisions));
    for (const i of group) startTick[i] = tick;
  }

  const raw: QNote[] = kept.map((n, i) => {
    const start = startTick[i]!;
    const end = Math.round(toBeats(n.start + n.duration) * divisions);
    return {
      pitch: n.pitch,
      start,
      duration: Math.max(1, end - start),
      hand: staffHand(n.hand, n.pitch, splitPitch),
      velocity: n.velocity,
    };
  });

  const tempos: QTempo[] = [];
  for (const t of tempoMap) {
    const tick = Math.max(0, Math.round(secondsToBeats(tempoMap, t.time) * divisions));
    const prev = tempos[tempos.length - 1];
    if (prev && prev.tick === tick) prev.bpm = t.bpm;
    else if (!prev || Math.abs(prev.bpm - t.bpm) > 1e-6) tempos.push({ tick, bpm: t.bpm });
  }

  return {
    title: score.title,
    divisions,
    timeSignature,
    key: opts.key ?? score.key ?? estimateKey(score.notes),
    tempos,
    notes: resolveSamePitch(raw),
    measureTicks: measureTicks(timeSignature, divisions),
    dropped,
  };
}

/**
 * Within one staff, the same pitch cannot sound twice at once: merge exact duplicates (same
 * start, keep the longer) and cut a held note where the next one of that pitch starts.
 */
export function resolveSamePitch(notes: QNote[]): QNote[] {
  const sorted = [...notes].sort((a, b) => (a.hand === b.hand ? 0 : a.hand === 'R' ? -1 : 1) || a.pitch - b.pitch || a.start - b.start);
  const out: QNote[] = [];
  for (const n of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.hand === n.hand && prev.pitch === n.pitch) {
      if (prev.start === n.start) {
        prev.duration = Math.max(prev.duration, n.duration);
        prev.velocity = Math.max(prev.velocity, n.velocity);
        continue;
      }
      if (prev.start + prev.duration > n.start) prev.duration = n.start - prev.start;
    }
    out.push({ ...n });
  }
  return out.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/**
 * True when the notes do not follow the Score's tempo map (e.g. audio or video transcription):
 * fewer than 80 % of onsets lie within 20 ms of a 1/16 grid position.
 */
export function isFreeTiming(score: Score): boolean {
  if (score.notes.length === 0) return false;
  const map = normalizeTempos(score.tempos);
  let onGrid = 0;
  for (const n of score.notes) {
    const beats = secondsToBeats(map, n.start);
    const snapped = Math.round(beats * 4) / 4;
    const secPerBeat = 60 / (map.findLast((t) => t.time <= n.start + 1e-9)?.bpm ?? 120);
    if (Math.abs(beats - snapped) * secPerBeat <= 0.02) onGrid++;
  }
  return onGrid / score.notes.length < 0.8;
}

/**
 * Tap tempo: timestamps in milliseconds (e.g. performance.now()) → BPM, or null with fewer than
 * two usable taps. Uses the taps after the last pause longer than 2 s, at most the last 8
 * intervals, and ignores intervals more than 30 % away from their median.
 */
export function tapTempo(taps: number[]): number | null {
  let from = 0;
  for (let i = 1; i < taps.length; i++) if (taps[i]! - taps[i - 1]! > 2000) from = i;
  const recent = taps.slice(from);
  const intervals: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const d = recent[i]! - recent[i - 1]!;
    if (d > 0) intervals.push(d);
  }
  const last = intervals.slice(-8);
  if (last.length === 0) return null;
  const sorted = [...last].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const good = last.filter((d) => Math.abs(d - median) <= 0.3 * median);
  const mean = good.reduce((s, d) => s + d, 0) / good.length;
  return Math.round((60000 / mean) * 10) / 10;
}

// Krumhansl–Kessler key profiles (C major / C minor).
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
/** Major-key tonic pitch class → circle-of-fifths position (Db, Eb, F#… spelled conventionally). */
const FIFTHS_OF_MAJOR = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

function correlation(a: number[], b: number[]): number {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Krumhansl–Schmuckler key estimate from a duration-weighted pitch-class histogram. */
export function estimateKey(notes: Pick<Note, 'pitch' | 'duration'>[]): KeySignature {
  const hist = new Array<number>(12).fill(0);
  for (const n of notes) hist[n.pitch % 12]! += n.duration;
  if (hist.every((x) => x === 0)) return { fifths: 0, mode: 'major' };
  let best = { score: -Infinity, tonic: 0, mode: 'major' as 'major' | 'minor' };
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = hist.map((_, i) => hist[(i + tonic) % 12]!);
    for (const mode of ['major', 'minor'] as const) {
      const r = correlation(rotated, mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE);
      if (r > best.score + 1e-12) best = { score: r, tonic, mode };
    }
  }
  const relativeMajor = best.mode === 'major' ? best.tonic : (best.tonic + 3) % 12;
  return { fifths: FIFTHS_OF_MAJOR[relativeMajor]!, mode: best.mode };
}
