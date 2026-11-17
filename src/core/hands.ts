import type { Hand, Note, Score, TrackInfo } from './score';

export interface AssignHandsOptions {
  /** Notes at or above this pitch go to the right hand when nothing else decides. Default 60 (C4). */
  splitPitch?: number;
}

/** Notes within this many semitones of the split are ambiguous and follow voice continuity. */
const CONTINUITY_ZONE = 5;
/** A previous note older than this (seconds since it ended) no longer counts as "recent". */
const CONTINUITY_WINDOW = 1.0;

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

/**
 * Assign hands by pitch split with simple voice continuity: a note far from the split goes to
 * the obvious hand; a note within CONTINUITY_ZONE of the split goes to the hand whose most
 * recent note is closest in pitch (if that note is recent enough), else by the split.
 * Chord tones (same onset) are decided together so a chord is never split arbitrarily across
 * the line: each tone is still judged on its own pitch, but continuity is looked up against
 * notes before the chord, not against other tones of the same chord.
 */
export function splitHands(notes: Note[], splitPitch = 60): Hand[] {
  const order = notes.map((_, i) => i).sort((a, b) => notes[a]!.start - notes[b]!.start || notes[a]!.pitch - notes[b]!.pitch);
  const out: Hand[] = new Array<Hand>(notes.length).fill(null);
  const last: Record<'L' | 'R', { pitch: number; end: number } | null> = { L: null, R: null };

  let i = 0;
  while (i < order.length) {
    const t = notes[order[i]!]!.start;
    let j = i;
    while (j < order.length && Math.abs(notes[order[j]!]!.start - t) < 1e-3) j++;
    const group = order.slice(i, j);
    const decided: { idx: number; hand: 'L' | 'R' }[] = [];
    for (const idx of group) {
      const n = notes[idx]!;
      let hand: 'L' | 'R' = n.pitch >= splitPitch ? 'R' : 'L';
      if (Math.abs(n.pitch - splitPitch) <= CONTINUITY_ZONE) {
        let best: { hand: 'L' | 'R'; dist: number } | null = null;
        for (const h of ['L', 'R'] as const) {
          const prev = last[h];
          if (!prev || t - prev.end > CONTINUITY_WINDOW) continue;
          const dist = Math.abs(prev.pitch - n.pitch);
          if (!best || dist < best.dist) best = { hand: h, dist };
        }
        if (best) hand = best.hand;
      }
      decided.push({ idx, hand });
    }
    // A chord tone in the right hand can never sit below a left-hand tone of the same chord.
    const lowestR = Math.min(...decided.filter((d) => d.hand === 'R').map((d) => notes[d.idx]!.pitch));
    for (const d of decided) {
      if (d.hand === 'L' && notes[d.idx]!.pitch > lowestR) d.hand = 'R';
    }
    for (const d of decided) out[d.idx] = d.hand;
    // Remember, per hand, the chord tone nearest the split (highest L, lowest R): that is the
    // voice the next ambiguous note is most likely to continue.
    for (const h of ['L', 'R'] as const) {
      const tones = decided.filter((d) => d.hand === h).map((d) => notes[d.idx]!);
      if (tones.length === 0) continue;
      const pick = tones.reduce((a, b) => (h === 'L' ? (b.pitch > a.pitch ? b : a) : b.pitch < a.pitch ? b : a));
      last[h] = { pitch: pick.pitch, end: Math.max(...tones.map((n) => n.start + n.duration)) };
    }
    i = j;
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
