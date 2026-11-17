/**
 * Key-estimation fixtures, written note by note in code for this project (no copyrighted
 * material). Each piece names the key a musician would write.
 */
import type { KeySignature } from '../../src/core/score';
import { ev, type FixtureEvent, type FixturePiece } from './music';

const S = 1;
const E = 2;
const Q = 4;
const DQ = 6;
const HD = 12;
const W = 16;

/** C major scale over I – IV – V⁷ – I, ending on a held tonic chord. */
export const cMajorCadence: FixturePiece = {
  title: 'C major scale and cadence',
  bpm: 100,
  beats: 4,
  beatType: 4,
  fifths: 0,
  measures: [
    [[ev('C5', Q), ev('D5', Q), ev('E5', Q), ev('F5', Q)], [ev(['C3', 'E3', 'G3'], W)]],
    [[ev('G5', Q), ev('A5', Q), ev('B5', Q), ev('C6', Q)], [ev(['F2', 'A3', 'C4'], W)]],
    [[ev('B5', Q), ev('A5', Q), ev('G5', Q), ev('F5', Q)], [ev(['G2', 'B3', 'D3', 'F3'], W)]],
    [[ev(['E5', 'C6'], W)], [ev(['C3', 'G3'], W)]],
  ],
};

/** A minor with the G♯ leading tone: i – iv – V – i – VI – V – i (3/4). */
export const aMinorLeadingTone: FixturePiece = {
  title: 'A minor with a leading tone',
  bpm: 96,
  beats: 3,
  beatType: 4,
  fifths: 0,
  measures: [
    [[ev('A4', Q), ev('B4', Q), ev('C5', Q)], [ev(['A2', 'E3', 'A3'], HD)]],
    [[ev('D5', Q), ev('C5', Q), ev('B4', Q)], [ev(['D3', 'F3', 'A3'], HD)]],
    [[ev('B4', Q), ev('G#4', Q), ev('E4', Q)], [ev(['E2', 'E3', 'G#3', 'B3'], HD)]],
    [[ev('C5', Q), ev('B4', Q), ev('A4', Q)], [ev(['A2', 'E3', 'A3'], HD)]],
    [[ev('E5', Q), ev('D5', Q), ev('C5', Q)], [ev(['F2', 'C3', 'A3'], HD)]],
    [[ev('B4', Q), ev('G#4', Q), ev('B4', Q)], [ev(['E2', 'E3', 'G#3', 'B3'], HD)]],
    [[ev(['A4', 'C5', 'E5'], HD)], [ev(['A2', 'A3'], HD)]],
  ],
};

/** The same piece ending on a Picardy third (A major chord). */
export const aMinorPicardy: FixturePiece = {
  ...aMinorLeadingTone,
  title: 'A minor ending on a Picardy third',
  measures: [...aMinorLeadingTone.measures.slice(0, -1), [[ev(['A4', 'C#5', 'E5'], HD)], [ev(['A2', 'A3'], HD)]]],
};

const aPedal = (upper: string[]): FixtureEvent[] => [ev('A2', E), ev(upper, E), ev('A2', E), ev(upper, E), ev('A2', E), ev(upper, E), ev('A2', E), ev(upper, E)];

/**
 * D major tune over a dominant pedal: the left hand keeps A in the bass (A2 on every beat, with
 * E–G / E–C♯ / F♯–D off-beats) for six bars and only resolves to D in the last one.
 */
export const dMajorOverAPedal: FixturePiece = {
  title: 'D major over an A pedal',
  bpm: 100,
  beats: 4,
  beatType: 4,
  fifths: 2,
  measures: [
    [[ev('F#5', Q), ev('E5', Q), ev('D5', Q), ev('A4', Q)], aPedal(['D3', 'F#3'])],
    [[ev('G5', Q), ev('F#5', Q), ev('E5', Q), ev('C#5', Q)], aPedal(['E3', 'G3'])],
    [[ev('D5', Q), ev('E5', Q), ev('F#5', Q), ev('G5', Q)], aPedal(['D3', 'F#3'])],
    [[ev('A5', Q), ev('G5', Q), ev('F#5', Q), ev('E5', Q)], aPedal(['C#3', 'E3'])],
    [[ev('B4', Q), ev('C#5', Q), ev('D5', Q), ev('E5', Q)], aPedal(['D3', 'G3'])],
    [[ev('C#5', Q), ev('E5', Q), ev('G5', Q), ev('E5', Q)], aPedal(['C#3', 'G3'])],
    [[ev(['D5', 'F#5', 'A5'], W)], [ev(['D2', 'D3'], W)]],
  ],
};

const C8 = ['C5', 'C6'];
/** LH bar on the C pedal: C2 on beat 1, C3 on beat 2, E–G off-beats. */
const cPedal: FixtureEvent[] = [ev('C2', E), ev(['E3', 'G3'], E), ev(['E3', 'G3'], E), ev('C3', E), ev(['E3', 'G3'], E), ev(['E3', 'G3'], E)];

/**
 * Shaped like the real recording this was tuned for (an F-major siciliano theme over a C pedal,
 * 6/8): repeated C octaves in the right hand, the left hand on C with E–G off-beats, the bass
 * leaving the pedal only for F (I) and D (vi) at the start of a phrase, three B♭s against three
 * chromatic B♮ neighbour notes of the same length, an A♭ (minor colour) in the last bar, and no
 * final F chord: it stops on the pedal, as an excerpt does.
 */
export const fMajorPedalExcerpt: FixturePiece = {
  title: 'F major theme over a C pedal (excerpt)',
  bpm: 90,
  beats: 6,
  beatType: 8,
  fifths: -1,
  measures: [
    [[ev(C8, Q), ev(C8, E), ev(C8, Q), ev(C8, E)], cPedal],
    [[ev(C8, Q), ev('Bb4', E), ev('A4', Q), ev('G4', E)], cPedal],
    [[ev(['F4', 'A4', 'C5'], Q), ev('C5', E), ev(['F4', 'A4', 'F5'], Q), ev('E5', E)], [ev('F2', E), ev(['C3', 'A3'], E), ev(['C3', 'A3'], E), ev('F2', E), ev(['C3', 'A3'], E), ev(['C3', 'A3'], E)]],
    [[ev(['D5', 'F5'], Q), ev('C5', E), ev(['Bb4', 'D5'], Q), ev('G4', E)], [ev('D2', E), ev(['F3', 'A3'], E), ev(['F3', 'A3'], E), ev('D2', E), ev(['F3', 'A3'], E), ev(['F3', 'A3'], E)]],
    [[ev(C8, Q), ev('B4', E), ev(C8, Q), ev(C8, E)], cPedal],
    [[ev(['E4', 'C5'], Q), ev('B4', E), ev(['E4', 'C5'], Q), ev('G4', E)], cPedal],
    [[ev(['E4', 'C5'], Q), ev('B4', E), ev(C8, Q), ev('Bb4', E)], cPedal],
    [[ev(['Ab4', 'C5'], Q), ev('G4', E), ev(C8, DQ - E), ev('G4', S), ev('E4', S)], [ev('Ab2', E), ev(['C3', 'F3'], E), ev(['C3', 'F3'], E), ev('C2', E), ev(['E3', 'G3'], E), ev(['E3', 'G3'], E)]],
  ],
};

/** Expected keys, for the confusion summary. */
export const KEY_OF: Record<string, KeySignature> = {
  [cMajorCadence.title]: { fifths: 0, mode: 'major' },
  [aMinorLeadingTone.title]: { fifths: 0, mode: 'minor' },
  [aMinorPicardy.title]: { fifths: 0, mode: 'minor' },
  [dMajorOverAPedal.title]: { fifths: 2, mode: 'major' },
  [fMajorPedalExcerpt.title]: { fifths: -1, mode: 'major' },
};
