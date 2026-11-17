/**
 * Pure checks of two audio clean-up fixes (no model run):
 * - flat-topped onset peaks (note-decoder.ts `plateauPeaks`), which made the original Basic Pitch
 *   decoder drop the loudest note of a file (seen as B4 → B5 in the e2e C-major scale);
 * - the overtone filter keeps a struck octave whose onset is as strong as the lower note's
 *   (postprocess.ts `ghostOnsetRatio`), and still drops a weak-onset overtone.
 */
import { describe, expect, test } from 'vitest';
import { outputToNotesPolyFast } from '../../src/converters/inputs/audio/note-decoder';
import { dropHarmonicGhosts, type RawNoteEvent } from '../../src/converters/inputs/audio/postprocess';

/** frames × 88 matrices with one note at `bin`: frame activation `level` from `from` on, onsets as given. */
function activations(nFrames: number, bin: number, from: number, level: number, onsetsAt: Record<number, number>) {
  const frames = Array.from({ length: nFrames }, (_, r) => Array.from({ length: 88 }, (_, c) => (c === bin && r >= from ? level : 0.05)));
  const onsets = Array.from({ length: nFrames }, (_, r) => Array.from({ length: 88 }, (_, c) => (c === bin ? (onsetsAt[r] ?? 0.05) : 0.05)));
  return { frames, onsets };
}

describe('note decoder: flat-topped onset peaks', () => {
  test('a peak of two equal frames is a note with plateauPeaks, lost without it (original behaviour)', () => {
    const { frames, onsets } = activations(60, 50, 10, 0.8, { 9: 0.5, 10: 0.96, 11: 0.96, 12: 0.4 });
    const strict = outputToNotesPolyFast(frames, onsets, 0.5, 0.3, 5, false, false);
    const fixed = outputToNotesPolyFast(frames, onsets, 0.5, 0.3, 5, false, false, 11, true);
    expect(strict).toHaveLength(0);
    expect(fixed).toHaveLength(1);
    expect(fixed[0]).toMatchObject({ startFrame: 10, pitchMidi: 71 });
  });

  test('a strict peak gives the same note either way', () => {
    const { frames, onsets } = activations(60, 50, 10, 0.8, { 9: 0.5, 10: 0.96, 11: 0.9 });
    expect(outputToNotesPolyFast(frames, onsets, 0.5, 0.3, 5, false, false, 11, true)).toEqual(
      outputToNotesPolyFast(frames, onsets, 0.5, 0.3, 5, false, false),
    );
  });
});

describe('overtone filter and real octaves', () => {
  const ev = (pitch: number, amplitude: number, onsetStrength: number): RawNoteEvent => ({
    start: 1,
    duration: 0.5,
    pitch,
    amplitude,
    onsetStrength,
  });
  const lower = ev(72, 0.8, 0.95);

  test('a struck upper octave (onset as strong as the lower note) survives with an onset ratio', () => {
    const octave = ev(84, 0.45, 0.83);
    expect(dropHarmonicGhosts([lower, octave], 0.85, 0.6)).toEqual([lower]); // M4 rule: lost
    expect(dropHarmonicGhosts([lower, octave], 0.85, 0.6, 0.8)).toHaveLength(2);
  });

  test('a weak-onset overtone is still dropped', () => {
    const ghost = ev(84, 0.35, 0.6);
    expect(dropHarmonicGhosts([lower, ghost], 0.85, 0.6, 0.8)).toEqual([lower]);
  });
});
