/**
 * Seeded random "dev set" for tuning the audio post-processing (M4), kept apart from the test
 * fixtures in transcription-fixtures.ts, which act as the held-out set.
 * 3 monophonic melodies (random walk in C major, 80–130 bpm) and 3 two-hand pieces
 * (melody with occasional thirds over a I–IV–V–I–vi–IV–V–I progression played as block
 * chords, Alberti-style broken chords or bass + off-beat chords, 70–120 bpm). 32 beats each.
 * Original note data, generated in code.
 */
import { createScore, type Note, type Score } from '../../src/core/score';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SCALE = [0, 2, 4, 5, 7, 9, 11];
/** Scale degree → MIDI pitch (degree 0 = `base`, C major). */
const deg = (d: number, base = 60) => base + 12 * Math.floor(d / 7) + SCALE[((d % 7) + 7) % 7]!;

export function devMelody(seed: number): Score {
  const r = rng(seed);
  const spb = 60 / (80 + r() * 50);
  const notes: Note[] = [];
  let b = 0;
  let d = 2 + Math.floor(r() * 5);
  while (b < 32) {
    const len = [0.5, 0.5, 1, 1, 1, 1.5, 2][Math.floor(r() * 7)]!;
    d = Math.max(-2, Math.min(11, d + Math.floor(r() * 5) - 2));
    notes.push({ pitch: deg(d), start: b * spb, duration: len * spb * (0.8 + r() * 0.15), velocity: 0.5 + r() * 0.4, hand: 'R', track: 0 });
    b += len;
  }
  return createScore({ title: `Dev melody ${seed}`, notes });
}

export function devTwoHand(seed: number): Score {
  const r = rng(seed);
  const spb = 60 / (70 + r() * 50);
  const notes: Note[] = [];
  let b = 0;
  let d = 4;
  while (b < 32) {
    const len = [0.5, 1, 1, 1, 1.5, 2][Math.floor(r() * 6)]!;
    d = Math.max(0, Math.min(11, d + Math.floor(r() * 5) - 2));
    notes.push({ pitch: deg(d), start: b * spb, duration: len * spb * 0.9, velocity: 0.6 + r() * 0.3, hand: 'R', track: 0 });
    if (r() < 0.25) notes.push({ pitch: deg(d - 2), start: b * spb, duration: len * spb * 0.9, velocity: 0.5 + r() * 0.3, hand: 'R', track: 0 });
    b += len;
  }
  const prog = [0, 3, 4, 0, 5, 3, 4, 0];
  for (let bar = 0; bar < 8; bar++) {
    const root = prog[bar]!;
    const t0 = bar * 4;
    const style = Math.floor(r() * 3);
    const chord = [deg(root, 48), deg(root + 2, 48), deg(root + 4, 48)];
    const left = (pitch: number, beat: number, beats: number, velocity: number) =>
      notes.push({ pitch, start: beat * spb, duration: beats * spb, velocity, hand: 'L', track: 0 });
    if (style === 0) {
      chord.forEach((p) => left(p, t0, 3.6, 0.5));
      left(deg(root, 36), t0, 3.6, 0.55);
    } else if (style === 1) {
      const pat = [chord[0]!, chord[2]!, chord[1]!, chord[2]!];
      for (let i = 0; i < 8; i++) left(pat[i % 4]!, t0 + i * 0.5, 0.45, 0.45);
    } else {
      left(deg(root, 36), t0, 1.8, 0.55);
      for (const k of [1, 2, 3]) for (const p of chord.slice(1)) left(p, t0 + k, 0.8, 0.45);
    }
  }
  // A key cannot sound twice at once: drop notes that would overlap the same pitch.
  const sorted = createScore({ notes });
  const keep: Note[] = [];
  for (const n of sorted.notes) {
    if (!keep.some((k) => k.pitch === n.pitch && k.start + k.duration > n.start - 0.01)) keep.push(n);
  }
  return createScore({ title: `Dev two-hand ${seed}`, notes: keep });
}

export interface DevPiece {
  name: string;
  kind: 'monophonic' | 'two-hand';
  score: Score;
  /** Seed for the synth's noise/phases. */
  synthSeed: number;
}

/** The six dev pieces used to choose DEFAULT_POSTPROCESS (docs/DECISIONS.md, 2026-11-17). */
export function audioDevSet(): DevPiece[] {
  const pieces: [string, DevPiece['kind'], Score][] = [
    ['dmono1', 'monophonic', devMelody(11)],
    ['dmono2', 'monophonic', devMelody(12)],
    ['dmono3', 'monophonic', devMelody(13)],
    ['dtwo1', 'two-hand', devTwoHand(21)],
    ['dtwo2', 'two-hand', devTwoHand(22)],
    ['dtwo3', 'two-hand', devTwoHand(23)],
  ];
  return pieces.map(([name, kind, score]) => ({
    name,
    kind,
    score,
    synthSeed: name.length * 7 + name.charCodeAt(name.length - 1),
  }));
}
