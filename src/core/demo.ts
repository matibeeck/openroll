/**
 * Built-in example: Beethoven's "Ode to Joy" theme (public domain), two hands, written in code.
 * Lets people try the app without a file of their own.
 */
import { createScore, type Note, type Score } from './score';
import { assignHands } from './hands';

const BEAT = 0.6; // 100 BPM
// Right hand as [pitch, beats], 16 bars in four 4-bar phrases: A, A (second ending), B, A.
const PHRASE: [number, number][] = [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64].map((p) => [p, 1]);
const END_A: [number, number][] = [
  [64, 1.5],
  [62, 0.5],
  [62, 2],
];
const END_B: [number, number][] = [
  [62, 1.5],
  [60, 0.5],
  [60, 2],
];
const BRIDGE: [number, number][] = [
  [62, 1],
  [62, 1],
  [64, 1],
  [60, 1],
  [62, 1],
  [64, 0.5],
  [65, 0.5],
  [64, 1],
  [60, 1],
  [62, 1],
  [64, 0.5],
  [65, 0.5],
  [64, 1],
  [62, 1],
  [60, 1],
  [62, 1],
  [55, 2],
];
const MELODY = [...PHRASE, ...END_A, ...PHRASE, ...END_B, ...BRIDGE, ...PHRASE, ...END_B];
// Left hand: one bass note per bar, played as two half notes.
const BASS = [48, 43, 48, 43, 48, 43, 48, 48, 43, 48, 43, 43, 48, 43, 48, 48];

export function demoScore(): Score {
  const notes: Note[] = [];
  let t = 0;
  for (const [p, beats] of MELODY) {
    notes.push({ pitch: p, start: t, duration: BEAT * beats * 0.95, velocity: 0.75, hand: 'R', track: 0 });
    t += BEAT * beats;
  }
  BASS.forEach((p, i) => {
    for (const half of [0, 1]) {
      notes.push({
        pitch: p,
        start: i * 4 * BEAT + half * 2 * BEAT,
        duration: BEAT * 1.9,
        velocity: 0.55,
        hand: 'L',
        track: 1,
      });
    }
  });
  return assignHands(
    createScore({
      title: 'Ode to Joy (Beethoven)',
      notes,
      tracks: [
        { name: 'Right hand', hand: 'R' },
        { name: 'Left hand', hand: 'L' },
      ],
      tempos: [{ time: 0, bpm: 100 }],
      timeSignature: { numerator: 4, denominator: 4 },
      key: { fifths: 0, mode: 'major' },
    }),
  );
}
