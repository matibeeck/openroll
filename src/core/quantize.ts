/**
 * Quantization: Score (seconds) → notes on a beat grid, ready for notation.
 * Pure functions only. Ticks here are grid ticks: `divisions` per quarter note.
 *
 * Rules: snap onsets to the grid; notes whose onsets lie within `chordTolerance` of each other
 * form one chord and snap together; drop notes shorter than `minDuration`; never invent notes.
 * For recordings (`legato`), note ends follow the next onset of the same hand, so the sheet is
 * not littered with rests and ties from articulation and decay.
 */
import { pulseIndex } from './meter';
import type { Hand, KeySignature, Note, PedalSpan, Score, TempoEvent, TimeSignature } from './score';
import { normalizeTempos, secondsToBeats } from './tempo';

/** A tracked pulse grid (see estimateMeter): pulse times in seconds, pulses[0] on a downbeat. */
export interface PulseTimeline {
  pulses: number[];
  /** Quarter notes per pulse. */
  pulseQuarters: number;
  /** Tempo to print (quarter notes per minute). */
  bpm: number;
}

/** Smallest note value of the grid: 'auto' picks 1/16 unless sixteenths would be faster than 90 ms. */
export type GridChoice = 'auto' | 8 | 16 | 32;

export interface QuantizeOptions {
  /** Use this constant tempo instead of the Score's tempo map (free-timing input). */
  bpm?: number;
  /** With `bpm`: shift time so the first note starts on beat 1. Default true when `bpm` is set. */
  alignFirstNote?: boolean;
  timeSignature?: TimeSignature;
  /**
   * Follow this tracked pulse grid (rubato-aware) instead of a constant tempo; overrides `bpm`
   * and the Score's tempo map.
   */
  timeline?: PulseTimeline;
  /** Grid ticks per quarter note: 4 = 1/16 (default), 2 = 1/8, 8 = 1/32. Overrides `grid`. */
  divisions?: number;
  /** Smallest note value when `divisions` is not given. Default 16 (or 'auto' with a timeline). */
  grid?: GridChoice;
  /**
   * Recording mode: extend each note to the next onset of its hand (sustain pedal included),
   * keep rests only for silences longer than a beat, and start them on a beat.
   */
  legato?: boolean;
  /**
   * Easier reading: one grid level coarser, ornaments (very short notes right before another
   * note of the same hand) merged into the main note, one voice per staff, rests only for
   * silences longer than a bar.
   */
  simplify?: boolean;
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
  /** Notes dropped as too short (or merged as ornaments). */
  dropped: number;
  /** Voices per staff for the notation layout (1 when simplified). */
  maxVoices?: number;
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

/** Ticks per quarter for a grid choice; 'auto' keeps sixteenths at ≥ 90 ms, else eighths. */
export function gridDivisions(grid: GridChoice, sixteenthSeconds: number, simplify = false): number {
  let div = grid === 'auto' ? (sixteenthSeconds >= 0.09 ? 4 : 2) : grid / 4;
  if (simplify) div = Math.max(2, div / 2);
  return div;
}

/**
 * Automatic grid from the onsets themselves: eighths, unless more than 30 % of the onsets sit
 * clearly between eighths (and sixteenths last at least 90 ms). `onsets` are in quarter notes.
 */
export function autoDivisions(onsets: number[], sixteenthSeconds: number): number {
  if (sixteenthSeconds < 0.09 || onsets.length === 0) return 2;
  const between = onsets.filter((b) => Math.abs(b * 2 - Math.round(b * 2)) > 0.3).length;
  return between / onsets.length > 0.3 ? 4 : 2;
}

/** Note end in seconds, held by the sustain pedal when the key is released while it is down. */
export function pedalEnd(end: number, pedal: PedalSpan[] | undefined): number {
  if (!pedal) return end;
  for (const p of pedal) if (p.start <= end && end < p.end) return p.end;
  return end;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
}

export function quantize(score: Score, opts: QuantizeOptions = {}): QuantizedScore {
  // Hands in a recording are rarely together: a wider window keeps their chords in one onset.
  const chordTol = opts.chordTolerance ?? (opts.legato ? 0.06 : 0.035);
  const minDur = opts.minDuration ?? 0.25;
  const splitPitch = opts.splitPitch ?? 60;
  const timeSignature = opts.timeSignature ?? score.timeSignature;
  const simplify = opts.simplify ?? false;

  let tempoMap: TempoEvent[];
  let offset = 0;
  let toBeats: (s: number) => number;
  let sixteenth: number;
  const tl = opts.timeline && opts.timeline.pulses.length >= 2 ? opts.timeline : undefined;
  if (tl) {
    tempoMap = [{ time: 0, bpm: tl.bpm }];
    toBeats = (s) => Math.max(0, pulseIndex(tl.pulses, s) * tl.pulseQuarters);
    const period = median(tl.pulses.slice(1).map((t, i) => t - tl.pulses[i]!));
    sixteenth = (period * 0.25) / tl.pulseQuarters;
  } else {
    if (opts.bpm && opts.bpm > 0) {
      tempoMap = [{ time: 0, bpm: opts.bpm }];
      const first = score.notes.reduce((m, n) => Math.min(m, n.start), Infinity);
      if ((opts.alignFirstNote ?? true) && Number.isFinite(first)) offset = first;
    } else {
      tempoMap = normalizeTempos(score.tempos);
    }
    toBeats = (s) => secondsToBeats(tempoMap, Math.max(0, s - offset));
    sixteenth = 15 / tempoMap[0]!.bpm;
  }
  const gridChoice = opts.grid ?? (tl ? 'auto' : 16);
  const divisions =
    opts.divisions ??
    (gridChoice === 'auto' && !simplify ? autoDivisions(score.notes.map((n) => toBeats(n.start)), sixteenth) : gridDivisions(gridChoice, sixteenth, simplify));
  const beat = beatTicksOf(timeSignature, divisions);
  const measure = measureTicks(timeSignature, divisions);
  const hand = (n: Note) => staffHand(n.hand, n.pitch, splitPitch);

  // Drop micro-notes (measured in grid steps at their position) before anything else.
  // Simplify also merges ornaments: a note under half a grid step followed within one step by
  // another note of the same hand.
  let dropped = 0;
  const kept: Note[] = [];
  const byStart = [...score.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  byStart.forEach((n, i) => {
    const b0 = toBeats(n.start);
    const steps = (toBeats(n.start + n.duration) - b0) * divisions;
    let ornament = false;
    if (simplify && steps < 0.5) {
      const h = hand(n);
      for (let j = i + 1; j < byStart.length; j++) {
        const m = byStart[j]!;
        const d = (toBeats(m.start) - b0) * divisions;
        if (d > 1) break;
        if (m.start - n.start > chordTol && hand(m) === h) {
          ornament = true;
          break;
        }
      }
    }
    if (steps < minDur || ornament) dropped++;
    else kept.push(n);
  });

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

  const ends = kept.map((n) => toBeats(opts.legato ? pedalEnd(n.start + n.duration, score.pedal) : n.start + n.duration) * divisions);
  let raw: QNote[] = kept.map((n, i) => {
    const start = startTick[i]!;
    return {
      pitch: n.pitch,
      start,
      duration: Math.max(1, Math.round(ends[i]!) - start),
      hand: hand(n),
      velocity: n.velocity,
    };
  });
  if (opts.legato) raw = legatoDurations(raw, ends, { beat, measure, simplify });

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
    measureTicks: measure,
    dropped,
    ...(simplify ? { maxVoices: 1 } : {}),
  };
}

/** Ticks per beat (dotted quarter in compound meters). */
function beatTicksOf(ts: TimeSignature, divisions: number): number {
  const unit = (4 * divisions) / ts.denominator;
  const compound = ts.denominator >= 8 && ts.numerator % 3 === 0 && ts.numerator > 3;
  return Math.max(1, Math.round(compound ? unit * 3 : unit));
}

/**
 * Legato durations for recordings. Per hand, with `next` = the next onset of that hand:
 * - a note that sounds until `next`, or stops less than `restMax` before it (one beat; one bar
 *   when simplifying), ends exactly at `next`: articulation gaps do not become rests;
 * - a longer silence keeps a rest, but the note is extended to the next beat so the rest starts
 *   on a beat; the last note of a hand always lasts to the end of its beat;
 * - unless simplifying, the lowest (highest) tone of a chord that rings on for more than a beat
 *   past `next` is kept as a held voice until the bass (melody) moves again (a note within a
 *   fifth above (below) it).
 * `ends` are the raw note ends in grid ticks (not rounded, pedal included).
 */
export function legatoDurations(notes: QNote[], ends: number[], o: { beat: number; measure: number; simplify: boolean }): QNote[] {
  const restMax = o.simplify ? o.measure : o.beat;
  const out = notes.map((n) => ({ ...n }));
  for (const h of ['L', 'R'] as const) {
    const idx = out.map((_, i) => i).filter((i) => out[i]!.hand === h);
    const onsets = [...new Set(idx.map((i) => out[i]!.start))].sort((a, b) => a - b);
    const chordAt = new Map<number, number[]>();
    for (const i of idx) chordAt.set(out[i]!.start, [...(chordAt.get(out[i]!.start) ?? []), out[i]!.pitch]);
    const ceilBeat = (t: number) => Math.ceil(t / o.beat - 1e-9) * o.beat;
    for (const i of idx) {
      const n = out[i]!;
      const end = ends[i]!;
      const k = onsets.findIndex((t) => t > n.start);
      const next = k >= 0 ? onsets[k]! : undefined;
      let e: number;
      if (next === undefined) {
        e = ceilBeat(end);
      } else if (next - end <= restMax) {
        e = next;
        const chord = chordAt.get(n.start)!;
        const lowest = n.pitch === Math.min(...chord);
        const highest = n.pitch === Math.max(...chord);
        if (!o.simplify && end >= next + o.beat && (lowest || highest)) {
          // Held voice: until the same outer voice moves (a lower bass / a higher melody note).
          let cut = Math.round(end);
          for (let j = k; j < onsets.length && onsets[j]! < cut; j++) {
            const c = chordAt.get(onsets[j]!)!;
            if ((lowest && Math.min(...c) <= n.pitch + 7) || (highest && !lowest && Math.max(...c) >= n.pitch - 7)) {
              cut = onsets[j]!;
              break;
            }
          }
          e = Math.max(next, cut);
        }
      } else {
        e = Math.min(next, Math.max(Math.round(end), ceilBeat(end)));
      }
      n.duration = Math.max(1, e - n.start);
    }
  }
  return out;
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

// Temperley's key profiles (Kostka–Payne corpus; C major / C minor). Compared with
// Krumhansl–Kessler they weigh the tonic triad less against the 6th, so a melody that keeps
// repeating the 3rd (C in A♭ major) is not read as the relative minor's tonic.
const MAJOR_PROFILE = [0.748, 0.06, 0.488, 0.082, 0.67, 0.46, 0.096, 0.715, 0.104, 0.366, 0.057, 0.4];
const MINOR_PROFILE = [0.712, 0.084, 0.474, 0.618, 0.049, 0.46, 0.105, 0.747, 0.404, 0.067, 0.133, 0.33];
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

/**
 * Krumhansl–Schmuckler key estimate (Temperley's profiles) from a pitch-class histogram weighted
 * by duration (capped at 1.5 s, so pedalled or decaying notes do not dominate) with bass notes
 * (lowest of their onset, below C4) counted twice: the bass carries the harmony. The signature
 * is then settled against its circle-of-fifths neighbours by the accidentals it would need
 * (see closestSignature).
 */
export function estimateKey(notes: (Pick<Note, 'pitch' | 'duration'> & { start?: number })[]): KeySignature {
  const hist = new Array<number>(12).fill(0);
  const sorted = [...notes].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  let j = 0;
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i]!;
    let bass = false;
    if (n.start !== undefined && n.pitch < 60) {
      while (sorted[j]!.start! < n.start - 0.05) j++;
      bass = true;
      for (let k = j; k < sorted.length && sorted[k]!.start! <= n.start + 0.05; k++) if (sorted[k]!.pitch < n.pitch) bass = false;
    }
    hist[((n.pitch % 12) + 12) % 12]! += Math.min(n.duration, 1.5) * (bass ? 2 : 1);
  }
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
  const fifths = FIFTHS_OF_MAJOR[relativeMajor]!;
  return { fifths: closestSignature(hist, fifths), mode: best.mode };
}

/** Pitch classes of the major scale with this signature (−1 = F major: F G A B♭ C D E). */
function scaleOf(fifths: number): Set<number> {
  return new Set([-1, 0, 1, 2, 3, 4, 5].map((q) => ((((q + fifths) * 7) % 12) + 12) % 12));
}

/**
 * Settle the signature between the correlated key and its two neighbours on the circle of
 * fifths. Profile correlation weighs tonic and dominant most, so it cannot tell a key from the
 * key a fifth away when the music sits on a pedal (F major over a long C bass reads as C major).
 * Neighbouring keys share six of their seven scale tones; the evidence that separates them is
 * the one that differs (B♭ vs B♮ for F vs C). Take the signature that leaves the least weighted
 * mass outside its scale — i.e. needs the fewest accidentals on the page; ties keep the
 * correlated key.
 */
export function closestSignature(hist: number[], fifths: number): number {
  const outside = (f: number) => {
    const scale = scaleOf(f);
    return hist.reduce((sum, w, pc) => sum + (scale.has(pc) ? 0 : w), 0);
  };
  let best = fifths;
  for (const f of [fifths - 1, fifths + 1]) {
    if (f < -7 || f > 7) continue;
    if (outside(f) < outside(best) - 1e-9) best = f;
  }
  return best;
}
