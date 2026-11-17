import type { Hand, Note, Score, TrackInfo } from './score';

export interface AssignHandsOptions {
  /** Notes at or above this pitch go to the right hand when nothing else decides. Default 60 (C4). */
  splitPitch?: number;
}

/**
 * Guess a hand from a track or staff name. Returns undefined when the name says nothing.
 * Recognizes: left/right, LH/RH, "Piano left", bass/treble, staff 1/2 (1 = right, 2 = left),
 * and the Spanish izquierda/derecha, mano izq./der.
 */
export function handFromName(name: string | undefined): Hand | undefined {
  if (!name) return undefined;
  const s = name.toLowerCase();
  const left = /\b(left|lh|l\.h|bass|izquierda|mano\s+izq|staff\s*2|pentagrama\s*2)\b/.test(s);
  const right = /\b(right|rh|r\.h|treble|derecha|mano\s+der|staff\s*1|pentagrama\s*1)\b/.test(s);
  if (left && !right) return 'L';
  if (right && !left) return 'R';
  return undefined;
}

/** Hand hints per track: explicit TrackInfo.hand wins, else derived from the name. */
export function trackHands(tracks: TrackInfo[]): (Hand | undefined)[] {
  return tracks.map((t) => (t.hand !== undefined && t.hand !== null ? t.hand : handFromName(t.name)));
}

/** Largest comfortable span of one hand: a ninth (14 semitones). */
export const MAX_HAND_SPAN = 14;
/** Onsets closer than this are one chord for hand separation (hands are rarely exactly together). */
const CHORD_TOLERANCE = 0.035;
const BEAM = 32;

interface HandPos {
  lo: number;
  hi: number;
  /** Last onset and last release of this hand (seconds). */
  time: number;
  end: number;
}

interface Hyp {
  cost: number;
  L: HandPos | null;
  R: HandPos | null;
  /** Index of the parent hypothesis in the previous beam, and how many chord tones went left. */
  parent: number;
  split: number;
}

/**
 * Cost of giving `tones` (ascending pitches of one chord) to a hand that was last at `prev`.
 * - span: more than MAX_HAND_SPAN is (nearly) unplayable; 13–14 is mildly penalized;
 * - more than 5 tones in one hand is impossible;
 * - register: a weak pull towards the split, stronger far from it (an L note two octaves above
 *   middle C is unlikely);
 * - leap: a jump of the hand's center beyond a fifth/sixth (7 semitones) from where it last
 *   played, weighted more when there was little time to move.
 */
function handCost(h: 'L' | 'R', tones: number[], prev: HandPos | null, t: number, split: number): number {
  if (tones.length === 0) return 0;
  const lo = tones[0]!;
  const hi = tones[tones.length - 1]!;
  let c = 0;
  const span = hi - lo;
  if (span > MAX_HAND_SPAN) c += 6 + 1.5 * (span - MAX_HAND_SPAN);
  else if (span > 12) c += 0.3 * (span - 12);
  if (tones.length > 5) c += 10 * (tones.length - 5);
  for (const p of tones) {
    const beyond = h === 'L' ? p - split : split - p;
    if (beyond > 0) c += 0.1 * beyond + 0.12 * Math.max(0, beyond - 7);
  }
  if (prev) {
    const dt = t - prev.time;
    const center = (lo + hi) / 2;
    const prevCenter = (prev.lo + prev.hi) / 2;
    const leap = Math.abs(center - prevCenter);
    const w = dt < 0.15 ? 1.5 : dt < 1 ? 1 : dt < 3 ? 0.5 : 0.15;
    c += 0.1 * w * Math.max(0, leap - 7);
  }
  return c;
}

/** Hands crossing: a right-hand tone below the left hand's notes that are still sounding (or vice versa). */
function crossCost(lTones: number[], rTones: number[], L: HandPos | null, R: HandPos | null, t: number): number {
  let c = 0;
  const recent = (p: HandPos | null) => p !== null && p.end > t - 0.15;
  if (rTones.length && recent(L) && rTones[0]! < L!.hi) c += 0.4 * (L!.hi - rTones[0]!);
  if (lTones.length && recent(R) && lTones[lTones.length - 1]! > R!.lo) c += 0.4 * (lTones[lTones.length - 1]! - R!.lo);
  return c;
}

/**
 * Assign hands by voice leading and hand span. Onsets within 35 ms form a chord; each chord is
 * split at one point (tones below go left, so a right-hand tone is never below a left-hand tone
 * of the same chord), and a beam search over the chords minimizes the total cost: spans wider
 * than a ninth, more than five tones per hand, notes far into the other hand's register, leaps
 * from where the hand last played, and crossing the other hand's sounding notes. With nothing
 * else to decide, notes go by the split pitch (default C4).
 */
export function splitHands(notes: Note[], splitPitch = 60): Hand[] {
  const order = notes.map((_, i) => i).sort((a, b) => notes[a]!.start - notes[b]!.start || notes[a]!.pitch - notes[b]!.pitch);
  const groups: number[][] = [];
  for (const i of order) {
    const g = groups[groups.length - 1];
    if (g && notes[i]!.start - notes[g[0]!]!.start <= CHORD_TOLERANCE) g.push(i);
    else groups.push([i]);
  }
  for (const g of groups) g.sort((a, b) => notes[a]!.pitch - notes[b]!.pitch);

  const beams: Hyp[][] = [];
  let beam: Hyp[] = [{ cost: 0, L: null, R: null, parent: -1, split: 0 }];
  for (const g of groups) {
    const tones = g.map((i) => notes[i]!.pitch);
    const t = notes[g[0]!]!.start;
    const end = Math.max(...g.map((i) => notes[i]!.start + notes[i]!.duration));
    const next: Hyp[] = [];
    beam.forEach((h, hi) => {
      for (let k = 0; k <= tones.length; k++) {
        const l = tones.slice(0, k);
        const r = tones.slice(k);
        const cost =
          h.cost + handCost('L', l, h.L, t, splitPitch) + handCost('R', r, h.R, t, splitPitch) + crossCost(l, r, h.L, h.R, t);
        const pos = (ts: number[], prev: HandPos | null): HandPos | null =>
          ts.length ? { lo: ts[0]!, hi: ts[ts.length - 1]!, time: t, end } : prev;
        next.push({ cost, L: pos(l, h.L), R: pos(r, h.R), parent: hi, split: k });
      }
    });
    // Keep the best hypothesis per hand position, then the BEAM best overall.
    next.sort((a, b) => a.cost - b.cost);
    const seen = new Set<string>();
    beam = [];
    for (const h of next) {
      const key = `${h.L?.lo},${h.L?.hi},${h.R?.lo},${h.R?.hi}`;
      if (seen.has(key)) continue;
      seen.add(key);
      beam.push(h);
      if (beam.length >= BEAM) break;
    }
    beams.push(beam);
  }

  const out: Hand[] = new Array<Hand>(notes.length).fill(null);
  let idx = 0;
  for (let gi = groups.length - 1; gi >= 0; gi--) {
    const h = beams[gi]![idx]!;
    groups[gi]!.forEach((noteIdx, j) => {
      out[noteIdx] = j < h.split ? 'L' : 'R';
    });
    idx = h.parent;
  }
  return out;
}

/**
 * Return a copy of `score` with every note's hand set.
 * - If track/staff names identify hands (at least one track says L or R), notes on those tracks
 *   get that hand; notes on unlabeled tracks are split by pitch.
 * - Otherwise every note is split by pitch at `splitPitch` (default 60 = C4) with voice continuity.
 * Never adds or removes notes. Also fills TrackInfo.hand for tracks whose name was recognized.
 */
export function assignHands(score: Score, opts?: { splitPitch?: number }): Score {
  const splitPitch = opts?.splitPitch ?? 60;
  const hints = trackHands(score.tracks);
  const tracks = score.tracks.map((t, i) => (hints[i] ? { ...t, hand: hints[i] } : { ...t }));

  const unlabeled: number[] = [];
  const notes = score.notes.map((n, i) => {
    const h = hints[n.track];
    if (h) return { ...n, hand: h };
    unlabeled.push(i);
    return { ...n };
  });

  if (unlabeled.length > 0) {
    const split = splitHands(
      unlabeled.map((i) => notes[i]!),
      splitPitch,
    );
    unlabeled.forEach((noteIdx, k) => {
      notes[noteIdx]!.hand = split[k]!;
    });
  }
  return { ...score, tracks, notes };
}
