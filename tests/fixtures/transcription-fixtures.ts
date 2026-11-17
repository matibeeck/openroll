/**
 * Original note data for the transcription round-trip tests (audio and falling-notes video).
 * Written for this project; no copyrighted material.
 */
import { createScore, type Hand, type Note, type Score } from '../../src/core/score';

/** [pitch, startBeat, lengthBeats] */
type BeatNote = [number, number, number];

function fromBeats(
  title: string,
  bpm: number,
  parts: { notes: BeatNote[]; hand: Hand; track: number; velocity: number }[],
  trackNames: string[],
): Score {
  const spb = 60 / bpm;
  const notes: Note[] = [];
  for (const part of parts) {
    for (const [pitch, beat, len] of part.notes) {
      notes.push({
        pitch,
        start: Math.round(beat * spb * 1e6) / 1e6,
        // Slightly detached articulation, as a pianist would play.
        duration: Math.round(len * spb * 0.9 * 1e6) / 1e6,
        velocity: part.velocity,
        hand: part.hand,
        track: part.track,
      });
    }
  }
  return createScore({
    title,
    notes,
    tracks: trackNames.map((name, i) => ({ name, hand: parts.find((p) => p.track === i)?.hand ?? null })),
    tempos: [{ time: 0, bpm }],
  });
}

/** Sequential notes laid end to end from a start beat. Pitch 0 = rest. */
function seq(startBeat: number, items: [number, number][]): BeatNote[] {
  const out: BeatNote[] = [];
  let b = startBeat;
  for (const [pitch, len] of items) {
    if (pitch > 0) out.push([pitch, b, len]);
    b += len;
  }
  return out;
}

// Pitches
const C3 = 48, D3 = 50, E3 = 52, F3 = 53, G3 = 55, A3 = 57, B3 = 59;
const C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, B4 = 71;
const C5 = 72, D5 = 74, E5 = 76, F5 = 77, G5 = 79;
const C2 = 36, F2 = 41, G2 = 43, A2 = 45, B2 = 47;

/**
 * Monophonic melody, 100 bpm, ~16 s, 30 notes. Quarters, eighths, a dotted rhythm,
 * repeated same-pitch notes and a range of C4–G5.
 */
export function monophonicMelody(): Score {
  const melody = seq(0, [
    [E4, 1], [G4, 1], [C5, 1.5], [B4, 0.5],
    [A4, 1], [G4, 1], [E4, 2],
    [F4, 0.5], [F4, 0.5], [A4, 1], [D5, 1], [C5, 1],
    [B4, 1], [G4, 0.5], [A4, 0.5], [B4, 2],
    [C5, 1], [E5, 1], [G5, 1], [E5, 1],
    [D5, 0.5], [C5, 0.5], [D5, 0.5], [E5, 0.5], [D5, 2],
    [C5, 1], [G4, 1], [E4, 1], [D4, 1],
    [C4, 3],
  ]);
  return fromBeats('Fixture: monophonic melody', 100, [{ notes: melody, hand: 'R', track: 0, velocity: 0.75 }], ['Piano']);
}

/**
 * Two-hand piece, 90 bpm, ~23 s. Right hand melody with some dyads; left hand bass notes,
 * broken-chord accompaniment and block chords (real polyphony, overlapping notes, octaves).
 */
export function twoHandPiece(): Score {
  const rh: BeatNote[] = [
    ...seq(0, [
      [G4, 1], [E4, 0.5], [F4, 0.5], [G4, 1], [C5, 1],
      [B4, 1], [A4, 0.5], [B4, 0.5], [G4, 2],
      [A4, 1], [C5, 1], [F5, 1], [E5, 0.5], [D5, 0.5],
      [E5, 1.5], [D5, 0.5], [C5, 2],
      [E5, 0.5], [D5, 0.5], [C5, 0.5], [B4, 0.5], [A4, 1], [F4, 1],
      [G4, 1], [B4, 1], [D5, 2],
      [C5, 1], [G4, 1], [E4, 1], [G4, 1],
    ]),
    // Dyads under the long notes, and the final chord.
    [E4, 6, 2], [E4, 14, 2], [B4, 26, 2], [E4, 32, 3], [G4, 32, 3], [C5, 32, 3],
  ];
  const lh: BeatNote[] = [
    // Bar 1–2: bass + broken chord in eighths.
    ...seq(0, [[C3, 0.5], [G3, 0.5], [E3, 0.5], [G3, 0.5], [C3, 0.5], [G3, 0.5], [E3, 0.5], [G3, 0.5]]),
    ...seq(4, [[G2, 0.5], [D3, 0.5], [G3, 0.5], [D3, 0.5], [G2, 0.5], [B3, 0.5], [D3, 0.5], [B3, 0.5]]),
    // Bar 3–4: block chords.
    [F2, 8, 2], [F3, 8, 2], [A3, 8, 2], [C4, 8, 2],
    [A2, 10, 2], [E3, 10, 2], [A3, 10, 2],
    [C3, 12, 2], [G3, 12, 2], [C4, 12, 2],
    [G2, 14, 2], [G3, 14, 2], [B3, 14, 2],
    // Bar 5–6: walking bass in quarters.
    ...seq(16, [[A2, 1], [C3, 1], [E3, 1], [C3, 1], [G2, 1], [B2, 1], [D3, 1], [F3, 1]]),
    // Bar 7–9: cadence, broken chord, then a bass octave under the final chord.
    [C3, 24, 2], [G3, 24, 2], [G2, 26, 2], [D3, 26, 2], [F3, 26, 2],
    ...seq(28, [[C3, 1], [G3, 1], [E3, 1], [G3, 1]]),
    [C2, 32, 3], [C3, 32, 3],
  ];
  return fromBeats(
    'Fixture: two-hand piece',
    90,
    [
      { notes: rh, hand: 'R', track: 0, velocity: 0.8 },
      { notes: lh, hand: 'L', track: 1, velocity: 0.6 },
    ],
    ['Right hand', 'Left hand'],
  );
}
