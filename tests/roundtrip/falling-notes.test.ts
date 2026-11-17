/**
 * Round trip: fixture Score → renderFrame (software rasterizer, several themes / colors /
 * resolutions / keyboard sizes) → falling-notes detector → note F1 (pitch exact, onset ±50 ms).
 * Target (docs/PLAN.md M5): F1 ≥ 0.95 on generated frames.
 *
 * The pipeline mirrors the browser converter: median of 9 frames → auto calibration → keyboard
 * strips (only the calibrated rows) streamed to the tracker at 30 fps → notesToScore.
 */
import { describe, expect, test } from 'vitest';
import type { Score } from '../../src/core/score';
import { CONFIDENCE_OK } from '../../src/converters/inputs/falling-notes-video/detect';
import { fastRepeatsPiece, monophonicMelody, twoHandPiece } from '../fixtures/transcription-fixtures';
import { detectFromRenders, handAccuracy, type RenderSpec } from './falling-notes-helpers';
import { formatMetrics, noteF1, report } from './metrics';

interface Variant {
  name: string;
  render: RenderSpec;
  noise?: number;
  /** Whether the two hands have distinct colors (hands must then come out right). */
  colorHands: boolean;
}

const VARIANTS: Variant[] = [
  { name: 'dark 1280x720 88 keys', render: { width: 1280, height: 720, theme: 'dark' }, colorHands: true },
  { name: 'light 1280x720 88 keys', render: { width: 1280, height: 720, theme: 'light' }, colorHands: true },
  {
    name: 'dark 854x480 custom colors',
    render: { width: 854, height: 480, theme: 'dark', handColors: { R: '#ef4444', L: '#a855f7', none: '#eab308' } },
    colorHands: true,
  },
  {
    name: 'light 640x360 custom colors',
    render: { width: 640, height: 360, theme: 'light', handColors: { R: '#f97316', L: '#14b8a6', none: '#eab308' } },
    colorHands: true,
  },
  { name: 'dark 1280x720 76 keys', render: { width: 1280, height: 720, theme: 'dark', low: 28, high: 103 }, colorHands: true },
  { name: 'light 960x540 61 keys', render: { width: 960, height: 540, theme: 'light', low: 36, high: 96 }, colorHands: true },
  {
    name: 'dark 1280x720 one color',
    render: { width: 1280, height: 720, theme: 'dark', handColors: { R: '#22c55e', L: '#22c55e', none: '#22c55e' } },
    colorHands: false,
  },
  { name: 'dark 1280x720 noise ±20', render: { width: 1280, height: 720, theme: 'dark' }, noise: 20, colorHands: true },
];

const FIXTURES: [string, () => Score][] = [
  ['monophonic', monophonicMelody],
  ['two-hand', twoHandPiece],
  ['fast repeats', fastRepeatsPiece],
];

describe('falling-notes video → Score round trip', () => {
  for (const v of VARIANTS) {
    test(`${v.name}: F1 ≥ 0.95`, () => {
      const t0 = performance.now();
      for (const [fname, make] of FIXTURES) {
        const ref = make();
        const { estimate, calibration: cal } = detectFromRenders(ref, v.render, v.noise);
        const m = noteF1(ref.notes, estimate.notes, 0.05);
        const hands = handAccuracy(ref, estimate);
        report(
          `[falling-notes] ${formatMetrics(`${v.name} / ${fname}`, m)} | hands ${(hands * 100).toFixed(1)}% | ` +
            `calibration keys ${cal.low}–${cal.high} conf ${cal.confidence.toFixed(2)}`,
        );
        if (m.missed.length) report(`[falling-notes]   missed: ${m.missed.map((x) => `${x.pitch}@${x.start.toFixed(2)}`).join(' ')}`);
        if (m.extra.length) report(`[falling-notes]   extra:  ${m.extra.map((x) => `${x.pitch}@${x.start.toFixed(2)}`).join(' ')}`);
        expect(cal.confidence).toBeGreaterThanOrEqual(CONFIDENCE_OK);
        expect(cal.low).toBe(v.render.low ?? 21);
        expect(cal.high).toBe(v.render.high ?? 108);
        expect(m.f1).toBeGreaterThanOrEqual(0.95);
        if (v.colorHands && fname !== 'monophonic') expect(hands).toBeGreaterThanOrEqual(0.95);
        expect(estimate.notes.every((n) => n.hand === 'L' || n.hand === 'R')).toBe(true);
      }
      report(`[falling-notes] ${v.name}: ${((performance.now() - t0) / 1000).toFixed(1)} s for all fixtures`);
    });
  }
});
