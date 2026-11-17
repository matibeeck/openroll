/**
 * Key estimation: Score notes (seconds) → key signature (fifths + mode). Pure functions only.
 *
 * score(key) = profile correlation + bass + cadence + final-chord evidence, for all 24 keys.
 *
 * 1. Pitch-class histogram: every note adds its duration clamped to [0.25 s, 1.5 s] (each onset
 *    counts, long or pedalled notes do not swamp the rest), correlated with Temperley's
 *    (Kostka–Payne) major/minor profiles.
 * 2. Bass: notes below middle C with no lower note sounding or starting within half a second
 *    (the lowest voice, not the low tones of a left-hand chord). Each key gains the share of bass
 *    weight on its tonic.
 * 3. Cadences: each time the bass falls a fifth onto X (V → I), X gains a vote for the mode
 *    whose third sounds over it (see cadenceVotes).
 * 4. Final chord: when the piece ends on a held chord (≥ 0.5 s, full weight from 1.5 s), keys
 *    whose tonic is its bass, whose tonic triad (with the mode's third) it contains, or whose
 *    dominant is the bass right before it (V → I) gain up to W_FINAL.
 * 5. Pedal: when the bass keeps striking one pitch class (at least half of the bass weight, and
 *    six or more bass notes in a row on it or its fifth), the music sits on a pedal. A pedal on
 *    P is the tonic of P or the dominant of P + 5 (F major over a C pedal) and its own chord
 *    (P, its third, P + 7) sounds all the time in both readings, so: the correlation ignores the
 *    pedal chord's three pitch classes, and the pedal's bass weight (also a final bass on the
 *    pedal) is split between P and P + 5. The other tones (B♭ vs B♮, the F and A of the
 *    resolution) and where the bass goes when it leaves the pedal decide.
 */
import type { KeySignature, Note } from './score';

/** Temperley's key profiles (Kostka–Payne corpus), C major / C minor. */
const MAJOR_PROFILE = [0.748, 0.06, 0.488, 0.082, 0.67, 0.46, 0.096, 0.715, 0.104, 0.366, 0.057, 0.4];
const MINOR_PROFILE = [0.712, 0.084, 0.474, 0.618, 0.049, 0.46, 0.105, 0.747, 0.404, 0.067, 0.133, 0.33];
/** Major-key tonic pitch class → circle-of-fifths position (D♭, E♭, F♯… spelled conventionally). */
const FIFTHS_OF_MAJOR = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

const MIN_WEIGHT = 0.25;
const MAX_WEIGHT = 1.5;
/** Bass: a lower note within this many seconds makes a note an inner voice. */
const BASS_WINDOW = 0.5;
const BASS_BELOW = 60;
/** Held notes are looked back for at most this long (seconds). */
const MAX_HELD = 8;
/** A final chord may be rolled: notes starting this close (seconds) to the last onset. */
const FINAL_ROLL = 0.15;
const W_BASS = 0.2;
const W_CADENCE = 0.15;
const W_FINAL = 0.25;
/** The chord a bass arrival brings: notes starting this long (seconds) after it. */
const ARRIVAL_WINDOW = 0.6;
const PEDAL_BASS_SHARE = 0.5;
const PEDAL_RUN = 6;

export type Mode = KeySignature['mode'];
export type KeyNote = Pick<Note, 'pitch' | 'duration'> & { start?: number };

export interface KeyCandidate {
  key: KeySignature;
  /** Tonic pitch class, 0 = C. */
  tonic: number;
  /** Profile correlation (on the pedal-free histogram when there is a pedal). */
  correlation: number;
  /** Correlation plus bass and final-chord evidence; candidates are ranked by it. */
  score: number;
}

export interface KeyAnalysis {
  key: KeySignature;
  /** All 24 keys, best first. */
  candidates: KeyCandidate[];
  /** Score of the best key minus the second best (0 when there are no notes). */
  margin: number;
  /** Pitch class of a detected pedal, else null. */
  pedal: number | null;
}

const pcOf = (pitch: number) => ((pitch % 12) + 12) % 12;

/** Key signature of a tonic pitch class and mode (minor keys take their relative major's signature). */
export function keyOf(tonic: number, mode: Mode): KeySignature {
  return { fifths: FIFTHS_OF_MAJOR[pcOf(mode === 'major' ? tonic : tonic + 3)]!, mode };
}

/** Tonic pitch class of a key signature. */
export function tonicOf(key: KeySignature): number {
  const major = pcOf(key.fifths * 7);
  return key.mode === 'major' ? major : pcOf(major + 9);
}

/** The 24 keys: C major, C minor, D♭ major, C♯ minor, … B major, B minor. */
export const ALL_KEYS: KeySignature[] = Array.from({ length: 24 }, (_, i) => keyOf(i >> 1, i % 2 ? 'minor' : 'major'));

/** Pearson correlation over the given indices. */
function correlation(a: number[], b: number[], idx: number[]): number {
  const ma = idx.reduce((s, i) => s + a[i]!, 0) / idx.length;
  const mb = idx.reduce((s, i) => s + b[i]!, 0) / idx.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (const i of idx) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

const noteWeight = (n: KeyNote) => Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, n.duration));

/** Lowest-voice notes (see the module comment), in time order. */
export function bassNotes<T extends KeyNote & { start: number }>(notes: T[]): T[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const out: T[] = [];
  let from = 0;
  for (const n of sorted) {
    if (n.pitch >= BASS_BELOW) continue;
    // Candidates: notes starting up to MAX_HELD seconds before n (they may still sound).
    while (sorted[from]!.start < n.start - MAX_HELD) from++;
    let lowest = true;
    for (let k = from; k < sorted.length && sorted[k]!.start <= n.start + BASS_WINDOW; k++) {
      const m = sorted[k]!;
      if (m.pitch >= n.pitch) continue;
      const near = m.start >= n.start - BASS_WINDOW;
      const sounding = m.start + m.duration > n.start;
      if (near || sounding) {
        lowest = false;
        break;
      }
    }
    if (lowest) out.push(n);
  }
  return out;
}

interface FinalChord {
  /** Pitch classes sounding in the final chord. */
  pcs: Set<number>;
  bass: number;
  /** Bass pitch class before the final one (for V → I), if any. */
  previousBass: number | null;
  /** 0–1: how clearly the piece ends on this chord (by how long it is held). */
  weight: number;
}

function finalChord(timed: (KeyNote & { start: number })[], bass: (KeyNote & { start: number })[]): FinalChord | null {
  if (timed.length === 0) return null;
  const last = timed.reduce((m, n) => Math.max(m, n.start), -Infinity);
  const chord = timed.filter((n) => n.start >= last - FINAL_ROLL);
  const end = chord.reduce((m, n) => Math.max(m, n.start + n.duration), -Infinity);
  const held = end - last;
  const weight = Math.max(0, Math.min(1, (held - 0.5) / 1.0));
  const low = chord.reduce((a, b) => (b.pitch < a.pitch ? b : a));
  const prior = bass.filter((n) => n.start < last - FINAL_ROLL && pcOf(n.pitch) !== pcOf(low.pitch));
  return {
    pcs: new Set(chord.map((n) => pcOf(n.pitch))),
    bass: pcOf(low.pitch),
    previousBass: prior.length ? pcOf(prior[prior.length - 1]!.pitch) : null,
    weight,
  };
}

/**
 * V → I evidence: every time the bass falls a fifth (or rises a fourth) onto X, X gains a vote,
 * for the mode whose third sounds above it within ARRIVAL_WINDOW (A over F: F major; A♭: F
 * minor; neither or both: half each). Moves inside a pedal figure (P ↔ P + 7) are the pedal, not
 * a cadence. Returns votes[tonic][0 = major, 1 = minor] as shares of all arrivals.
 */
export function cadenceVotes(timed: (KeyNote & { start: number })[], bass: (KeyNote & { start: number })[], pedal: number | null): number[][] {
  const votes = Array.from({ length: 12 }, () => [0, 0]);
  const sorted = [...timed].sort((a, b) => a.start - b.start);
  let arrivals = 0;
  let prev: number | null = null;
  for (const n of bass) {
    const pc = pcOf(n.pitch);
    if (prev === pc) continue;
    const inPedal = pedal !== null && (pc === pedal || pc === pcOf(pedal + 7)) && (prev === pedal || prev === pcOf(pedal + 7));
    if (prev !== null && prev === pcOf(pc + 7) && !inPedal) {
      const above = new Set(sorted.filter((m) => m.start >= n.start - 0.06 && m.start <= n.start + ARRIVAL_WINDOW).map((m) => pcOf(m.pitch)));
      const maj = above.has(pcOf(pc + 4));
      const min = above.has(pcOf(pc + 3));
      votes[pc]![0]! += maj === min ? 0.5 : maj ? 1 : 0;
      votes[pc]![1]! += maj === min ? 0.5 : min ? 1 : 0;
      arrivals++;
    }
    prev = pc;
  }
  return arrivals ? votes.map((v) => v.map((x) => x / arrivals)) : votes;
}

/**
 * Repeated bass pedal: one pitch class P carries at least half of the bass weight and the bass
 * strikes P (or P + 7, the other note of a pedal figure such as C–G) at least PEDAL_RUN times
 * in a row. A single long held bass note is not a pedal here: its weight is capped, so it does
 * not distort the histogram.
 */
export function findPedal(bassPcs: number[], bassShare: number[]): number | null {
  const p = bassShare.indexOf(Math.max(...bassShare));
  if (bassPcs.length === 0 || bassShare[p]! < PEDAL_BASS_SHARE) return null;
  let run = 0;
  let best = 0;
  let hasP = false;
  for (const pc of bassPcs) {
    if (pc === p || pc === pcOf(p + 7)) {
      run++;
      hasP ||= pc === p;
    } else {
      run = 0;
      hasP = false;
    }
    if (hasP) best = Math.max(best, run);
  }
  return best >= PEDAL_RUN ? p : null;
}

/** Rank all 24 keys for these notes (see the module comment). */
export function analyzeKey(notes: KeyNote[]): KeyAnalysis {
  const hist = new Array<number>(12).fill(0);
  for (const n of notes) hist[pcOf(n.pitch)]! += noteWeight(n);
  const fallback = keyOf(0, 'major');
  if (notes.length === 0) {
    return { key: fallback, candidates: ALL_KEYS.map((key) => ({ key, tonic: tonicOf(key), correlation: 0, score: 0 })), margin: 0, pedal: null };
  }

  const timed = notes.filter((n): n is KeyNote & { start: number } => n.start !== undefined);
  const bass = bassNotes(timed);
  const bassHist = new Array<number>(12).fill(0);
  for (const n of bass) bassHist[pcOf(n.pitch)]! += noteWeight(n);
  const bassTotal = bassHist.reduce((s, x) => s + x, 0);
  const bassShare = bassHist.map((x) => (bassTotal ? x / bassTotal : 0));

  const pedal = findPedal(bass.map((n) => pcOf(n.pitch)), bassShare);

  let idx = [...Array(12).keys()];
  if (pedal !== null) {
    const third = hist[pcOf(pedal + 4)]! >= hist[pcOf(pedal + 3)]! ? pcOf(pedal + 4) : pcOf(pedal + 3);
    const chord = new Set([pedal, pcOf(pedal + 7), third]);
    idx = idx.filter((i) => !chord.has(i));
    // Nothing but the pedal chord: it is the tonic chord.
    if (idx.reduce((s, i) => s + hist[i]!, 0) < 0.05 * hist.reduce((s, x) => s + x, 0)) idx = [...Array(12).keys()];
    // The pedal does not vote between its two readings: tonic of P or dominant of P + 5.
    const w = bassShare[pedal]!;
    bassShare[pedal] = w / 2;
    bassShare[pcOf(pedal + 5)]! += w / 2;
  }

  const fin = finalChord(timed, bass);
  const cadence = cadenceVotes(timed, bass, pedal);
  const candidates: KeyCandidate[] = ALL_KEYS.map((key) => {
    const tonic = tonicOf(key);
    const profile = key.mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE;
    const rotated = hist.map((_, i) => profile[pcOf(i - tonic)]!);
    const r = correlation(hist, rotated, idx);
    let final = 0;
    if (fin && fin.weight > 0) {
      const third = pcOf(tonic + (key.mode === 'major' ? 4 : 3));
      const onPedal = pedal !== null && fin.bass === pedal;
      // Ending on the pedal says nothing about which of its two readings is meant.
      const bassIsTonic = onPedal ? (tonic === pedal || tonic === pcOf(pedal + 5) ? 0.5 : 0) : fin.bass === tonic ? 1 : 0;
      const triad = fin.pcs.has(tonic) && fin.pcs.has(third) ? 1 : 0;
      const cadence = !onPedal && fin.bass === tonic && fin.previousBass === pcOf(tonic + 7) ? 1 : 0;
      final = fin.weight * (0.4 * bassIsTonic + 0.4 * triad + 0.2 * cadence);
    }
    const v = cadence[tonic]![key.mode === 'major' ? 0 : 1]!;
    return { key, tonic, correlation: r, score: r + W_BASS * bassShare[tonic]! + W_CADENCE * v + W_FINAL * final };
  });
  // Stable order on ties: the order of ALL_KEYS (C major first).
  candidates.sort((a, b) => b.score - a.score);
  return {
    key: candidates[0]!.key,
    candidates,
    margin: candidates[0]!.score - candidates[1]!.score,
    pedal,
  };
}

/** Estimated key signature of these notes (see analyzeKey). */
export function estimateKey(notes: KeyNote[]): KeySignature {
  return analyzeKey(notes).key;
}
