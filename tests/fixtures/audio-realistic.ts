/**
 * Recording-like variants of synthetic piano audio, in two STRICTLY SEPARATE sets:
 *
 * - TUNING set: the M4 dev pieces (tests/fixtures/audio-devset.ts: dtwo1–3 = devTwoHand 21–23,
 *   dmono1 = devMelody 11) and an octave piece (doct51 = devOctaves 51) × 4 variants,
 *   synth/noise seeds 1000+. Only this set may be used to
 *   choose post-processing rules or parameters (tests/roundtrip/audio-tuning.test.ts,
 *   TUNE_SET=realistic).
 * - EVALUATION set: pieces never used for tuning — the hand-written held-out fixtures
 *   (tests/fixtures/transcription-fixtures.ts: twoHandPiece, monophonicMelody) and three new
 *   seeded pieces (devTwoHand 41, devMelody 31, devOctaves 61) × the same 4 variants, seeds 5000+. Only
 *   reported (tests/roundtrip/audio-realistic.test.ts), never optimized against.
 *
 * Variants (stand-ins for a phone/laptop recording of an acoustic piano; still synthetic):
 *   room   damped room reverb (RT60 1.4 s, 35 % wet), pink noise at −48 dBFS, 50 Hz hum at −58 dBFS
 *   pedal  sustain pedal changed with the bass line, string resonance
 *   soft   pp–mp playing: velocities × 0.5, 30 dB velocity range, darker soft notes
 *   all    soft-ish (× 0.7) + pedal + a larger, wetter room (RT60 1.8 s, 40 %) + noise and hum
 * The reference for scoring is always the original Score (onsets and pitches are unchanged).
 */
import { createScore, type Note, type Score } from '../../src/core/score';
import { addReverb, addRoomNoise, sustainPedal, synthesizeScore, type SynthOptions } from '../roundtrip/synth';
import { devMelody, devTwoHand } from './audio-devset';
import { monophonicMelody, twoHandPiece } from './transcription-fixtures';

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
const deg = (d: number, base: number) => base + 12 * Math.floor(d / 7) + SCALE[((d % 7) + 7) % 7]!;

/**
 * Right-hand melody in octaves (both notes struck together, often repeated, as in many Romantic
 * themes) over a left-hand bass + chord per bar, 70–100 bpm, 32 beats. Octaves are where an
 * overtone filter can delete real notes (the upper note sits on the lower one's 2nd harmonic).
 */
export function devOctaves(seed: number): Score {
  const r = rng(seed);
  const spb = 60 / (70 + r() * 30);
  const notes: Note[] = [];
  let b = 0;
  let d = 2 + Math.floor(r() * 4);
  while (b < 32) {
    const len = [0.5, 1, 1, 1, 1.5, 2][Math.floor(r() * 6)]!;
    // Repeat the same note 40 % of the time, else a step or small leap.
    if (r() >= 0.4) d = Math.max(0, Math.min(9, d + Math.floor(r() * 5) - 2));
    const p = deg(d, 60);
    const velocity = 0.55 + r() * 0.35;
    for (const q of [p, p + 12]) notes.push({ pitch: q, start: b * spb, duration: len * spb * 0.9, velocity, hand: 'R', track: 0 });
    b += len;
  }
  const prog = [0, 3, 4, 0, 5, 3, 4, 0];
  for (let bar = 0; bar < 8; bar++) {
    const root = prog[bar]!;
    const t0 = bar * 4 * spb;
    notes.push({ pitch: deg(root, 36), start: t0, duration: 3.8 * spb, velocity: 0.55, hand: 'L', track: 0 });
    for (const k of [1, 2, 3])
      for (const x of [2, 4]) notes.push({ pitch: deg(root + x, 48), start: t0 + k * spb, duration: 0.8 * spb, velocity: 0.45, hand: 'L', track: 0 });
  }
  return createScore({ title: `Octaves ${seed}`, notes });
}

export type RealismVariant = 'room' | 'pedal' | 'soft' | 'all';
export const REALISM_VARIANTS: RealismVariant[] = ['room', 'pedal', 'soft', 'all'];

const SR = 22050;

export interface RealisticPiece {
  /** Unique name, e.g. `dtwo1/pedal`. */
  name: string;
  kind: 'monophonic' | 'two-hand';
  variant: RealismVariant;
  /** Reference notes (the unpedalled, original Score). */
  score: Score;
  seed: number;
}

function scaleVelocity(score: Score, k: number): Score {
  return { ...score, notes: score.notes.map((n) => ({ ...n, velocity: Math.max(0.05, n.velocity * k) })) };
}

/** Renders a piece at 22,050 Hz mono (deterministic for a given seed). */
export function renderRealistic(p: RealisticPiece): Float32Array {
  const synth: Partial<SynthOptions> = { seed: p.seed };
  switch (p.variant) {
    case 'room':
      return addRoomNoise(addReverb(synthesizeScore(p.score, synth), SR, 1.4, 0.35, 0.3), SR, {
        noiseDb: -48,
        humDb: -58,
        seed: p.seed + 1,
      });
    case 'pedal':
      return synthesizeScore(sustainPedal(p.score), { ...synth, resonance: 0.6 });
    case 'soft':
      return synthesizeScore(scaleVelocity(p.score, 0.5), { ...synth, dynamicRangeDb: 30, velocityTimbre: true });
    case 'all': {
      const dry = synthesizeScore(sustainPedal(scaleVelocity(p.score, 0.7)), {
        ...synth,
        dynamicRangeDb: 30,
        velocityTimbre: true,
        resonance: 0.6,
      });
      return addRoomNoise(addReverb(dry, SR, 1.8, 0.4, 0.3), SR, { noiseDb: -48, humDb: -58, seed: p.seed + 1 });
    }
  }
}

function expand(pieces: [string, RealisticPiece['kind'], Score][], seedBase: number): RealisticPiece[] {
  const out: RealisticPiece[] = [];
  pieces.forEach(([name, kind, score], i) =>
    REALISM_VARIANTS.forEach((variant, j) =>
      out.push({ name: `${name}/${variant}`, kind, variant, score, seed: seedBase + 10 * i + j }),
    ),
  );
  return out;
}

/** TUNING set: dev pieces only (also used by audio-devset.test.ts), seeds 1000+. */
export function realisticTuningSet(): RealisticPiece[] {
  return expand(
    [
      ['dtwo1', 'two-hand', devTwoHand(21)],
      ['dtwo2', 'two-hand', devTwoHand(22)],
      ['dtwo3', 'two-hand', devTwoHand(23)],
      ['dmono1', 'monophonic', devMelody(11)],
      ['doct51', 'two-hand', devOctaves(51)],
    ],
    1000,
  );
}

/** EVALUATION set: held-out pieces, seeds 5000+. Report only; never tune on it. */
export function realisticEvaluationSet(): RealisticPiece[] {
  return expand(
    [
      ['two-hand', 'two-hand', twoHandPiece()],
      ['etwo41', 'two-hand', devTwoHand(41)],
      ['monophonic', 'monophonic', monophonicMelody()],
      ['emono31', 'monophonic', devMelody(31)],
      ['eoct61', 'two-hand', devOctaves(61)],
    ],
    5000,
  );
}
