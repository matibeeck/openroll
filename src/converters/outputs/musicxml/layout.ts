/**
 * Notation layout (pure): quantized notes of one staff → voices → measure-sized pieces with
 * note values, ties and rests. All positions are grid ticks (`divisions` per quarter note).
 */
import type { QNote } from '../../../core/quantize';
import type { TimeSignature } from '../../../core/score';

export interface Chord {
  start: number;
  duration: number;
  /** Ascending. Empty = rest. */
  pitches: number[];
}

export interface Piece {
  kind: 'chord' | 'rest' | 'forward';
  /** Absolute tick. */
  start: number;
  duration: number;
  pitches: number[];
  tieStart: boolean;
  tieStop: boolean;
  /** Written note value (absent for forward and whole-measure rests). */
  value?: NoteValue;
  /** Whole-measure rest. */
  measureRest?: boolean;
}

export interface NoteValue {
  type: '32nd' | '16th' | 'eighth' | 'quarter' | 'half' | 'whole';
  dots: 0 | 1;
  /** Ticks. */
  ticks: number;
  /** Number of beams (0 for quarter and longer). */
  beams: number;
}

const TYPES: { type: NoteValue['type']; quarters: number; beams: number }[] = [
  { type: 'whole', quarters: 4, beams: 0 },
  { type: 'half', quarters: 2, beams: 0 },
  { type: 'quarter', quarters: 1, beams: 0 },
  { type: 'eighth', quarters: 0.5, beams: 1 },
  { type: '16th', quarters: 0.25, beams: 2 },
  { type: '32nd', quarters: 0.125, beams: 3 },
];

/** Note values representable at this resolution, longest first. */
export function noteValues(divisions: number): NoteValue[] {
  const out: NoteValue[] = [];
  for (const t of TYPES) {
    const base = t.quarters * divisions;
    if (Number.isInteger(base) && base >= 1) out.push({ type: t.type, dots: 0, ticks: base, beams: t.beams });
    const dotted = base * 1.5;
    if (Number.isInteger(dotted) && dotted >= 1 && t.type !== 'whole') out.push({ type: t.type, dots: 1, ticks: dotted, beams: t.beams });
  }
  return out.sort((a, b) => b.ticks - a.ticks);
}

/** Compound meter (6/8, 9/8, 12/8…): beats are dotted quarters. */
export function isCompound(ts: TimeSignature): boolean {
  return ts.denominator === 8 && ts.numerator % 3 === 0 && ts.numerator > 3;
}

/** Ticks per beat for alignment and beaming. */
export function beatTicks(ts: TimeSignature, divisions: number): number {
  const unit = (4 * divisions) / ts.denominator;
  return isCompound(ts) ? unit * 3 : Math.max(1, unit);
}

export interface DecomposeContext {
  values: NoteValue[];
  /** Ticks per beat. */
  beat: number;
  measureTicks: number;
  compound: boolean;
  /** Rests avoid dotted values in simple meter. */
  rest?: boolean;
}

/**
 * Split `duration` ticks starting `offset` ticks into the measure into note values that show
 * the beat:
 * - a value starts on a multiple of its undotted length when that length divides the measure
 *   (no half note on beat 2 of 4/4), else on a beat (a half note on beat 2 of 3/4 is fine);
 * - a value that starts off the beat does not cross the next beat;
 * - in even simple meters (2/4, 4/4…) a value that does not start the bar does not cross its middle;
 * - rests are never dotted in simple meter.
 * The smallest value (1 tick) always fits, so this terminates.
 */
export function decompose(offset: number, duration: number, ctx: DecomposeContext): NoteValue[] {
  const { values, beat, measureTicks, compound } = ctx;
  const half = !compound && measureTicks % (2 * beat) === 0 && measureTicks > 2 * beat ? measureTicks / 2 : 0;
  const out: NoteValue[] = [];
  let pos = offset;
  let left = duration;
  while (left > 0) {
    const onBeat = pos % beat === 0;
    const nextBeat = Math.ceil((pos + 1) / beat) * beat;
    const v =
      values.find((x) => {
        if (x.ticks > left) return false;
        if (ctx.rest && x.dots && !compound) return false;
        if (!onBeat && pos + x.ticks > nextBeat) return false;
        if (half && pos % half !== 0 && pos < half && pos + x.ticks > half) return false;
        const base = compound ? x.ticks : x.dots ? (x.ticks * 2) / 3 : x.ticks;
        const align = measureTicks % base === 0 ? base : Math.min(base, beat);
        return pos % align === 0;
      }) ?? values[values.length - 1]!;
    out.push(v);
    pos += v.ticks;
    left -= v.ticks;
  }
  return out;
}

/** Notes with the same start and duration form one chord. */
export function buildChords(notes: QNote[]): Chord[] {
  const map = new Map<string, Chord>();
  for (const n of notes) {
    const key = `${n.start}:${n.duration}`;
    const c = map.get(key) ?? { start: n.start, duration: n.duration, pitches: [] };
    if (!c.pitches.includes(n.pitch)) c.pitches.push(n.pitch);
    map.set(key, c);
  }
  const chords = [...map.values()];
  for (const c of chords) c.pitches.sort((a, b) => a - b);
  return chords.sort((a, b) => a.start - b.start || b.pitches[b.pitches.length - 1]! - a.pitches[a.pitches.length - 1]!);
}

/**
 * Distribute chords over at most `maxVoices` voices. Upper chords prefer voice 1. When every
 * voice is busy, the voice that frees up first has its last chord cut at the new onset (or, at
 * the same onset, the new pitches join that chord). Notes are never dropped.
 */
export function assignVoices(chords: Chord[], maxVoices = 2): Chord[][] {
  const voices: Chord[][] = [];
  const ends: number[] = [];
  for (const src of chords) {
    const c = { ...src, pitches: [...src.pitches] };
    let v = ends.findIndex((e) => e <= c.start);
    if (v < 0 && voices.length < maxVoices) {
      voices.push([]);
      ends.push(0);
      v = voices.length - 1;
    }
    if (v < 0) {
      v = ends.indexOf(Math.min(...ends));
      const last = voices[v]![voices[v]!.length - 1]!;
      if (last.start === c.start) {
        for (const p of c.pitches) if (!last.pitches.includes(p)) last.pitches.push(p);
        last.pitches.sort((a, b) => a - b);
        last.duration = Math.min(last.duration, c.duration);
        ends[v] = last.start + last.duration;
        continue;
      }
      last.duration = c.start - last.start;
    }
    voices[v]!.push(c);
    ends[v] = c.start + c.duration;
  }
  return voices;
}

/**
 * One voice → pieces covering [0, totalTicks): chords, and gaps as rests (voice 1) or forwards
 * (other voices). Pieces are split at barlines and at `extraSplits` (e.g. tempo changes), then
 * into note values; chord pieces of one note are tied together.
 */
export function voicePieces(
  chords: Chord[],
  opts: { totalTicks: number; measureTicks: number; divisions: number; timeSignature: TimeSignature; primary: boolean; extraSplits?: number[] },
): Piece[] {
  const { totalTicks, measureTicks, divisions, timeSignature, primary } = opts;
  const spans: { start: number; end: number; pitches: number[] }[] = [];
  let cursor = 0;
  for (const c of chords) {
    if (c.start > cursor) spans.push({ start: cursor, end: c.start, pitches: [] });
    spans.push({ start: c.start, end: c.start + c.duration, pitches: c.pitches });
    cursor = c.start + c.duration;
  }
  if (cursor < totalTicks) spans.push({ start: cursor, end: totalTicks, pitches: [] });

  const splits = new Set<number>(opts.extraSplits ?? []);
  for (let t = measureTicks; t < totalTicks; t += measureTicks) splits.add(t);
  const sortedSplits = [...splits].sort((a, b) => a - b);

  const values = noteValues(divisions);
  const beat = beatTicks(timeSignature, divisions);
  const compound = isCompound(timeSignature);
  const out: Piece[] = [];
  for (const s of spans) {
    const cuts = [s.start, ...sortedSplits.filter((t) => t > s.start && t < s.end), s.end];
    const isChord = s.pitches.length > 0;
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i]!;
      const b = cuts[i + 1]!;
      const offset = a % measureTicks;
      if (!isChord && !primary) {
        out.push({ kind: 'forward', start: a, duration: b - a, pitches: [], tieStart: false, tieStop: false });
        continue;
      }
      if (!isChord && offset === 0 && b - a === measureTicks) {
        out.push({ kind: 'rest', start: a, duration: b - a, pitches: [], tieStart: false, tieStop: false, measureRest: true });
        continue;
      }
      const parts = decompose(offset, b - a, { values, beat, measureTicks, compound, rest: !isChord });
      let pos = a;
      parts.forEach((v, j) => {
        out.push({
          kind: isChord ? 'chord' : 'rest',
          start: pos,
          duration: v.ticks,
          pitches: s.pitches,
          tieStop: isChord && (pos > s.start),
          tieStart: isChord && (i + 1 < cuts.length - 1 || j < parts.length - 1),
          value: v,
        });
        pos += v.ticks;
      });
    }
  }
  return out;
}
