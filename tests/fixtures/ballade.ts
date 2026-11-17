/**
 * Chopin, Ballade No. 3 in A♭ major, Op. 47 (public domain): the lilting second theme with the
 * right hand's repeated C octaves in the ♩ ♪ ♩ ♪ siciliano rhythm, over a left hand of bass
 * notes and off-beat chords. Entered note by note in code as a reduction of the passage (one
 * eighth pickup + 10 bars of 6/8), harmonized I – IV⁶₄ – I – V⁷ – I – V⁷/vi (E♮) – vi –
 * ii⁷/V⁷ – I. No copyrighted edition was used.
 */
import { createScore, type Note, type Score } from '../../src/core/score';
import { ev, pieceToScore, type FixtureEvent, type FixturePiece } from './music';

const E = 2; // eighth (DIVISIONS = 4 per quarter)
const Q = 4;
const DH = 12;

/** RH bar: chord on beat 1 (♩), C octave (♪), chord on beat 2 (♩), octave (♪). */
function rh(a: string[], b: string[], c: string[], d: string[]): FixtureEvent[] {
  return [ev(a, Q), ev(b, E), ev(c, Q), ev(d, E)];
}

/** LH bar: bass, chord, chord on beat 1; bass, chord, chord on beat 2 (all eighths). */
function lh(bass1: string, chord1: string[], bass2: string, chord2: string[]): FixtureEvent[] {
  return [ev(bass1, E), ev(chord1, E), ev(chord1, E), ev(bass2, E), ev(chord2, E), ev(chord2, E)];
}

const C8 = ['C5', 'C6'];

export const balladeTheme: FixturePiece = {
  title: 'Ballade No. 3 theme (Chopin)',
  bpm: 90, // quarter = 90: dotted quarter = 60
  beats: 6,
  beatType: 8,
  fifths: -4,
  measures: [
    // Pickup: the first repeated C on the last eighth.
    [[ev([], 10), ev(C8, E)], [ev([], 12)]],
    [rh(C8, C8, C8, C8), lh('Ab2', ['Eb3', 'C4'], 'Eb2', ['Eb3', 'C4'])],
    [rh(['C5', 'F5', 'C6'], C8, ['C5', 'F5', 'C6'], C8), lh('Ab2', ['F3', 'Db4'], 'Ab2', ['F3', 'Db4'])],
    [rh(['C5', 'Eb5', 'C6'], C8, ['C5', 'Ab5', 'C6'], C8), lh('Ab2', ['Eb3', 'C4'], 'Eb2', ['Ab3', 'C4'])],
    [rh(['C5', 'G5', 'C6'], C8, ['Bb4', 'Eb5', 'Bb5'], ['Bb4', 'Bb5']), lh('Eb2', ['G3', 'Db4'], 'Bb2', ['G3', 'Db4'])],
    [rh(['C5', 'Ab5', 'C6'], C8, ['C5', 'Eb5', 'C6'], C8), lh('Ab2', ['Eb3', 'C4'], 'Eb2', ['Ab3', 'Eb4'])],
    [rh(['C5', 'E5', 'C6'], C8, ['Bb4', 'E5', 'Bb5'], ['Bb4', 'Bb5']), lh('C3', ['E3', 'Bb3'], 'G2', ['E3', 'Bb3'])],
    [rh(['C5', 'F5', 'C6'], C8, ['C5', 'Ab5', 'C6'], C8), lh('F2', ['Ab3', 'C4'], 'C3', ['Ab3', 'C4'])],
    [rh(['Db5', 'F5', 'Db6'], ['Db5', 'Db6'], ['Bb4', 'Db5', 'G5'], ['Bb4', 'Bb5']), lh('Bb2', ['F3', 'Db4'], 'Eb2', ['G3', 'Db4'])],
    [rh(['C5', 'Eb5', 'C6'], C8, ['C5', 'Ab5', 'C6'], C8), lh('Ab2', ['Eb3', 'C4'], 'Eb2', ['Eb3', 'C4'])],
    [[ev(['Ab4', 'C5', 'Eb5', 'Ab5'], DH)], [ev(['Ab2', 'Eb3', 'Ab3'], DH)]],
  ],
};

/** Pitch classes the fixture uses, spelled: A♭ major plus E♮ (bar 6). */
export const BALLADE_SPELLING: Record<number, string> = {
  8: 'A-1',
  10: 'B-1',
  0: 'C0',
  1: 'D-1',
  3: 'E-1',
  4: 'E0',
  5: 'F0',
  7: 'G0',
};

/**
 * A fixture as played: mezza voce dynamics (top line louder than inner notes, LH chords soft),
 * gentle rubato (±5 % tempo over two bars), the bass a few ms ahead of the melody, small onset
 * jitter, and notes released slightly early (non-legato fingers, no pedal). The returned Score
 * says 120 BPM 4/4, like a transcription that knows nothing about the meter.
 */
export function performed(piece: FixturePiece): Score {
  const notated = pieceToScore(piece);
  const pulse = 60 / piece.bpm / 2; // eighth in seconds
  // Integrate the rubato over eighths.
  const times: number[] = [0];
  for (let k = 0; k < 400; k++) times.push(times[k]! + pulse * (1 + 0.05 * Math.sin((2 * Math.PI * k) / 12)));
  const warp = (s: number) => {
    const x = s / pulse;
    const k = Math.floor(x);
    return times[k]! + (x - k) * (times[k + 1]! - times[k]!);
  };
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const notes: Note[] = notated.notes.map((n) => {
    const lh = n.hand === 'L';
    const start = 0.3 + warp(n.start) + 0.008 * rand() - (lh ? 0.012 : 0);
    const end = 0.3 + warp(n.start + n.duration) - 0.04;
    const top = !lh && !notated.notes.some((m) => m.hand === 'R' && m.start === n.start && m.pitch > n.pitch);
    const bass = lh && n.pitch < 48;
    const velocity = top ? 0.62 : lh ? (bass ? 0.55 : 0.38) : 0.48;
    return { ...n, start, duration: Math.max(0.05, end - start), velocity };
  });
  return createScore({ ...notated, notes, tempos: [{ time: 0, bpm: 120 }], timeSignature: { numerator: 4, denominator: 4 } });
}

/** The Ballade theme as played (see `performed`). */
export function performedBallade(): Score {
  return performed(balladeTheme);
}

/**
 * Same texture as the second theme of the Ballade No. 3 as it is often first heard: an F-major
 * tune of repeated Cs (6/8) over a dominant pedal — the left hand keeps C in the bass with C–E–G
 * off-beats for seven bars and only resolves to F in the last one. Written in code for this
 * project. Tonic/dominant-heavy profiles read it as C major; the B♭s say F major.
 */
export const fMajorOverPedal: FixturePiece = {
  title: 'F major theme over a C pedal',
  bpm: 90,
  beats: 6,
  beatType: 8,
  fifths: -1,
  measures: [
    [rh(['C5'], ['C5'], ['C5'], ['C5']), lh('C2', ['E3', 'G3'], 'C3', ['E3', 'G3'])],
    [rh(['C5'], ['Bb4'], ['A4'], ['G4']), lh('C2', ['E3', 'G3'], 'C3', ['E3', 'G3'])],
    [rh(['C5'], ['C5'], ['C5'], ['D5']), lh('C2', ['E3', 'G3'], 'C3', ['E3', 'G3'])],
    [rh(['C5'], ['Bb4'], ['G4'], ['E4']), lh('C2', ['E3', 'G3'], 'C3', ['E3', 'G3'])],
    [rh(['C5'], ['C5'], ['F5'], ['E5']), lh('C2', ['E3', 'G3'], 'C3', ['E3', 'G3'])],
    [rh(['D5'], ['C5'], ['Bb4'], ['A4']), lh('C2', ['E3', 'G3'], 'C3', ['E3', 'G3'])],
    [rh(['G4'], ['A4'], ['Bb4'], ['G4']), lh('C2', ['E3', 'G3'], 'C3', ['E3', 'G3'])],
    [[ev(['F4', 'A4', 'C5'], DH)], [ev(['F2', 'C3', 'F3'], DH)]],
  ],
};
