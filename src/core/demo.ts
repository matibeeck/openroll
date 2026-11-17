/**
 * Built-in example: Beethoven's "Ode to Joy" theme (public domain), two hands, written in code.
 * Lets people try the app without a file of their own.
 */
import { createScore, type Note, type Score } from './score';
import { assignHands } from './hands';

const BEAT = 0.6; // 100 BPM
// Right hand: [pitch, beats]. Two 4-bar phrases, repeated with the second ending.
const PHRASE = [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64];
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
// Left hand: one chord root per bar (half notes).
const BASS_A = [48, 43, 48, 43, 48, 43, 48, 43];
const BASS_B = [48, 43, 48, 43, 48, 43, 43, 48];

export function demoScore(): Score {
  const notes: Note[] = [];
  let t = 0;
  for (const ending of [END_A, END_B]) {
    for (const p of PHRASE) {
      notes.push({ pitch: p, start: t, duration: BEAT * 0.95, velocity: 0.75, hand: 'R', track: 0 });
      t += BEAT;
    }
    for (const [p, beats] of ending) {
      notes.push({ pitch: p, start: t, duration: BEAT * beats * 0.95, velocity: 0.75, hand: 'R', track: 0 });
      t += BEAT * beats;
    }
  }
  [...BASS_A, ...BASS_B].forEach((p, i) => {
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
