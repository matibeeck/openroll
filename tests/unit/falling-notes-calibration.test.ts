import { describe, expect, test } from 'vitest';
import { frameGeometry } from '../../src/core/render';
import { scoreDuration, type Score } from '../../src/core/score';
import {
  autoCalibrate,
  clusterColors,
  medianFrame,
  type RgbaFrame,
} from '../../src/converters/inputs/falling-notes-video/detect';
import { monophonicMelody, twoHandPiece } from '../fixtures/transcription-fixtures';
import { detectFrames, placeInFrame, renderAt } from '../roundtrip/falling-notes-helpers';
import { formatMetrics, noteF1, report } from '../roundtrip/metrics';

const GRAY: [number, number, number] = [128, 128, 128];

function f1(ref: Score, est: Score): number {
  return noteF1(ref.notes, est.notes, 0.05).f1;
}

describe('falling-notes manual calibration', () => {
  test('keyboard drawn smaller and offset inside a bigger frame: manual ends (rows found automatically)', () => {
    const ref = twoHandPiece();
    const spec = { width: 1000, height: 500, theme: 'dark' as const };
    const frameAt = (t: number) => placeInFrame(renderAt(ref, t, spec), { x: 0, y: 0, w: 1000, h: 500 }, 1280, 720, 140, 160, GRAY);
    const run = detectFrames(frameAt, scoreDuration(ref) + 0.5, { left: 140, right: 1140, keys: 88 });
    const m = noteF1(ref.notes, run.estimate.notes, 0.05);
    report(`[falling-notes] ${formatMetrics('manual calibration, offset keyboard', m)}`);
    expect(run.calibration.source).toBe('manual');
    expect(run.calibration.low).toBe(21);
    expect(run.calibration.high).toBe(108);
    expect(Math.abs(run.calibration.top - (160 + 410))).toBeLessThanOrEqual(2);
    expect(m.f1).toBeGreaterThanOrEqual(0.95);
  });

  test('manual top/bottom are honored', () => {
    const ref = monophonicMelody();
    const spec = { width: 1000, height: 500, theme: 'light' as const };
    const frameAt = (t: number) => placeInFrame(renderAt(ref, t, spec), { x: 0, y: 0, w: 1000, h: 500 }, 1280, 720, 140, 160, GRAY);
    const run = detectFrames(frameAt, scoreDuration(ref) + 0.5, { left: 140, right: 1140, keys: 88, top: 570, bottom: 660 });
    expect(run.calibration.top).toBe(570);
    expect(run.calibration.bottom).toBe(660);
    expect(f1(ref, run.estimate)).toBeGreaterThanOrEqual(0.95);
  });

  test('cropped keyboard (61 keys from C3): auto cannot know the octave, manual lowest key fixes it', () => {
    const full = twoHandPiece();
    const spec = { width: 1280, height: 720, theme: 'dark' as const };
    const { layout } = frameGeometry({ ...spec, keyboardRatio: 0.18, low: 21, high: 108 });
    const x0 = Math.round(layout.byPitch.get(48)!.x);
    const w = 1280 - x0;
    const frameAt = (t: number) => placeInFrame(renderAt(full, t, spec), { x: x0, y: 0, w, h: 720 }, w, 720, 0, 0, GRAY);
    // Only keys C3–C8 are visible.
    const ref: Score = { ...full, notes: full.notes.filter((n) => n.pitch >= 48) };

    const autoRun = detectFrames(frameAt, scoreDuration(full) + 0.5);
    const manualRun = detectFrames(frameAt, scoreDuration(full) + 0.5, { left: 0, right: w, keys: 61, lowest: 48 });
    report(
      `[falling-notes] cropped C3–C8: auto calibration ${autoRun.auto?.low}–${autoRun.auto?.high} → F1 ${(f1(ref, autoRun.estimate) * 100).toFixed(1)}%; ` +
        `manual 48–108 → ${formatMetrics('F1', noteF1(ref.notes, manualRun.estimate.notes, 0.05))}`,
    );
    expect(manualRun.calibration.low).toBe(48);
    expect(manualRun.calibration.high).toBe(108);
    expect(f1(ref, manualRun.estimate)).toBeGreaterThanOrEqual(0.95);
  });
});

describe('falling-notes detector pieces', () => {
  test('median frame removes a transient', () => {
    const mk = (v: number): RgbaFrame => ({ width: 1, height: 1, data: new Uint8ClampedArray([v, v, v, 255]) });
    expect([...medianFrame([mk(10), mk(200), mk(12)]).data.slice(0, 3)]).toEqual([12, 12, 12]);
  });

  test('no keyboard in a flat frame', () => {
    const data = new Uint8ClampedArray(320 * 180 * 4).fill(128);
    expect(autoCalibrate({ width: 320, height: 180, data })).toBeNull();
  });

  test('colors split into two hands by hue, shades of one hue stay together', () => {
    const green: [number, number, number][] = [
      [34, 197, 94],
      [20, 120, 60],
      [40, 200, 100],
    ];
    const blue: [number, number, number][] = [
      [59, 130, 246],
      [30, 70, 150],
    ];
    const labels = clusterColors([...green, ...blue]);
    expect(labels).not.toBeNull();
    expect(new Set(labels!.slice(0, 3)).size).toBe(1);
    expect(labels![3]).toBe(labels![4]);
    expect(labels![0]).not.toBe(labels![3]);
    expect(clusterColors(green)).toBeNull();
  });
});
