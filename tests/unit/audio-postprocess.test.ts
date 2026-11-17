import { describe, expect, test } from 'vitest';
import {
  amplitudesToVelocities,
  cleanEvents,
  dropHarmonicGhosts,
  mergeFragments,
  postprocess,
  type RawNoteEvent,
} from '../../src/converters/inputs/audio/postprocess';

const ev = (pitch: number, start: number, duration: number, amplitude = 0.7, onsetStrength?: number): RawNoteEvent => ({
  pitch,
  start,
  duration,
  amplitude,
  onsetStrength,
});

describe('audio post-processing', () => {
  test('merges a weak-onset fragment into the note it continues', () => {
    const out = mergeFragments([ev(60, 0, 0.5, 0.8, 0.95), ev(60, 0.52, 0.3, 0.5, 0.3)], 0.05, 0.8);
    expect(out).toHaveLength(1);
    expect(out[0]!.start).toBe(0);
    expect(out[0]!.duration).toBeCloseTo(0.82);
  });

  test('keeps a genuine re-strike (strong onset) even when it overlaps the previous note', () => {
    const out = mergeFragments([ev(60, 0, 0.6, 0.8, 0.95), ev(60, 0.5, 0.3, 0.8, 0.9)], 0.05, 0.8);
    expect(out).toHaveLength(2);
  });

  test('does not merge notes separated by a real gap', () => {
    expect(mergeFragments([ev(60, 0, 0.3, 0.8, 0.9), ev(60, 0.5, 0.3, 0.5, 0.2)], 0.05, 0.8)).toHaveLength(2);
  });

  test('without onset info, merges only fragments that are not louder', () => {
    expect(mergeFragments([ev(60, 0, 0.3, 0.8), ev(60, 0.31, 0.3, 0.5)], 0.05, 0.8)).toHaveLength(1);
    expect(mergeFragments([ev(60, 0, 0.3, 0.5), ev(60, 0.31, 0.3, 0.8)], 0.05, 0.8)).toHaveLength(2);
  });

  test('drops a quiet weak-onset octave ghost but keeps a real octave', () => {
    const bass = ev(48, 1, 1, 0.8, 0.95);
    const ghost = ev(60, 1.01, 0.4, 0.35, 0.5);
    const realOctave = ev(60, 1.0, 1, 0.7, 0.93);
    expect(dropHarmonicGhosts([bass, ghost], 0.85, 0.6)).toEqual([bass]);
    expect(dropHarmonicGhosts([bass, realOctave], 0.85, 0.6)).toHaveLength(2);
  });

  test('min length and onset filter', () => {
    const out = cleanEvents([ev(60, 0, 0.03, 0.8, 0.9), ev(62, 0, 0.3, 0.8, 0.2), ev(64, 0, 0.3, 0.8, 0.9)], {
      minDuration: 0.05,
      minOnset: 0.6,
    });
    expect(out.map((e) => e.pitch)).toEqual([64]);
  });

  test('drops out-of-range and invalid events', () => {
    const out = cleanEvents([ev(10, 0, 0.3, 0.8, 0.9), ev(60, Number.NaN, 0.3), ev(60, 0, 0, 0.8, 0.9)]);
    expect(out).toHaveLength(0);
  });

  test('velocity follows amplitude, normalized to the loudest note', () => {
    const v = amplitudesToVelocities([0.2, 0.4, 0.8], 0.25, 1);
    expect(v[2]).toBe(1);
    expect(v[0]!).toBeLessThan(v[1]!);
    expect(v[0]!).toBeGreaterThanOrEqual(0.25);
  });

  test('produces a sorted Score with hands assigned', () => {
    const s = postprocess([ev(72, 0.5, 0.4, 0.8, 0.9), ev(40, 0, 0.5, 0.6, 0.9)], { title: 'x' });
    expect(s.title).toBe('x');
    expect(s.notes.map((n) => n.pitch)).toEqual([40, 72]);
    expect(s.notes.map((n) => n.hand)).toEqual(['L', 'R']);
    expect(s.tempos[0]!.time).toBe(0);
  });
});
