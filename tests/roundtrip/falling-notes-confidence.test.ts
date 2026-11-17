/**
 * Falling-notes keyboard calibration confidence → does the converter open the calibration dialog?
 *
 * A keyboard whose visible keys repeat at another octave inside A0–C8 (a crop such as C3–C8, or a
 * 61-key board, which looks exactly the same) cannot be placed from pixels: confidence must stay
 * below CONFIDENCE_OK so the converter asks. Same for cut-off keys and occlusions that break the
 * fit. Full 88- and 76-key keyboards are unique and must not trigger the dialog.
 * Frames come from the app's own renderer (tests/roundtrip/falling-notes-helpers.ts).
 */
import { describe, expect, test, vi } from 'vitest';
import { frameGeometry } from '../../src/core/render';
import { scoreDuration } from '../../src/core/score';
import {
  autoCalibrate,
  CONFIDENCE_OK,
  medianFrame,
  octaveAmbiguous,
  type Calibration,
  type ManualCalibration,
  type RgbaFrame,
} from '../../src/converters/inputs/falling-notes-video/detect';
import { confirmCalibration } from '../../src/converters/inputs/falling-notes-video/index';
import { twoHandPiece } from '../fixtures/transcription-fixtures';
import { detectFrames, lossy, placeInFrame, renderAt, type RenderSpec } from './falling-notes-helpers';
import { noteF1, report } from './metrics';

const ref = twoHandPiece();
const DURATION = scoreDuration(ref) + 0.5;
const GRAY: [number, number, number] = [128, 128, 128];
const DARK: RenderSpec = { width: 1280, height: 720, theme: 'dark' };

function idleFrame(frameAt: (t: number) => RgbaFrame): RgbaFrame {
  const frames: RgbaFrame[] = [];
  for (let i = 0; i < 9; i++) frames.push(frameAt(((i + 0.5) / 9) * DURATION));
  return medianFrame(frames);
}

/** The 88-key render cut horizontally from `from` (+ fraction of a white key) to `to` (or the right edge). */
function cropped(spec: RenderSpec, from: number, fromFrac: number, to: number | null, toFrac = 0) {
  const { layout } = frameGeometry({ keyboardRatio: 0.18, low: 21, high: 108, ...spec });
  const x0 = Math.round(layout.byPitch.get(from)!.x + fromFrac * layout.whiteWidth);
  const x1 = to === null ? spec.width : Math.round(layout.byPitch.get(to)!.x + toFrac * layout.whiteWidth);
  return (t: number) =>
    placeInFrame(renderAt(ref, t, spec), { x: x0, y: 0, w: x1 - x0, h: spec.height }, x1 - x0, spec.height, 0, 0, GRAY);
}

/** A dark overlay (logo, hand, caption box) over a horizontal span of the keyboard rows. */
function occluded(f: RgbaFrame, a: number, b: number): RgbaFrame {
  const d = f.data.slice();
  for (let y = Math.round(f.height * 0.8); y < f.height; y++) {
    for (let x = Math.round(a * f.width); x < Math.round(b * f.width); x++) {
      const i = (y * f.width + x) * 4;
      d[i] = 40;
      d[i + 1] = 40;
      d[i + 2] = 48;
    }
  }
  return { ...f, data: d };
}

interface Case {
  name: string;
  frameAt: (t: number) => RgbaFrame;
  /** Expected: the converter opens the dialog. */
  dialog: boolean;
  /** Expected auto range when it is still right (or the standard guess offered in the dialog). */
  range?: [number, number];
}

const CASES: Case[] = [
  { name: '88 keys, dark', frameAt: (t) => renderAt(ref, t, DARK), dialog: false, range: [21, 108] },
  { name: '88 keys, light 640×360', frameAt: (t) => renderAt(ref, t, { width: 640, height: 360, theme: 'light' }), dialog: false, range: [21, 108] },
  { name: '88 keys, lossy', frameAt: (t) => lossy()(renderAt(ref, t, DARK), t, 1), dialog: false, range: [21, 108] },
  {
    name: '88 keys, letterboxed',
    frameAt: (t) =>
      placeInFrame(renderAt(ref, t, { width: 1000, height: 500, theme: 'dark' }), { x: 0, y: 0, w: 1000, h: 500 }, 1280, 720, 140, 160, GRAY),
    dialog: false,
    range: [21, 108],
  },
  { name: '76 keys (E1–G7)', frameAt: (t) => renderAt(ref, t, { ...DARK, low: 28, high: 103 }), dialog: false, range: [28, 103] },
  // Octave cannot be known from the picture: a 61-key C2–C7 board and a C3–C8 crop are identical.
  { name: '61 keys (C2–C7)', frameAt: (t) => renderAt(ref, t, { width: 960, height: 540, theme: 'light', low: 36, high: 96 }), dialog: true, range: [36, 96] },
  { name: 'cropped C3–C8 (cut on a key edge)', frameAt: cropped(DARK, 48, 0, null), dialog: true, range: [36, 96] },
  { name: 'cropped A0–B6 (cut on a key edge)', frameAt: cropped(DARK, 21, 0, 96), dialog: true },
  { name: 'cropped mid-key D3+40 %…C8', frameAt: cropped(DARK, 50, 0.4, null), dialog: true },
  { name: 'cropped mid-key F2+30 %…G6+60 %', frameAt: cropped(DARK, 41, 0.3, 91, 0.6), dialog: true },
  { name: 'cropped two octaves C4–C6', frameAt: cropped(DARK, 60, 0, 84, 1), dialog: true },
  { name: '88 keys, right 35 % hidden by an overlay', frameAt: (t) => occluded(renderAt(ref, t, DARK), 0.65, 1), dialog: true },
];

function fmt(c: Calibration | null): string {
  if (!c) return 'no keyboard';
  const q = c.quality!;
  return (
    `${c.low}–${c.high} confidence ${c.confidence.toFixed(2)} (match ${q.match.toFixed(2)}, rms ${q.rms.toFixed(3)} ww, ` +
    `${q.blacks} black keys${q.issues.length ? `, ${q.issues.join(', ')}` : ''})`
  );
}

describe('falling-notes calibration confidence → calibration dialog', () => {
  for (const c of CASES) {
    test(`${c.name}: ${c.dialog ? 'low confidence, dialog opens' : 'high confidence, no dialog'}`, async () => {
      const idle = idleFrame(c.frameAt);
      const auto = autoCalibrate(idle);
      report(`[falling-notes confidence] ${c.name}: ${fmt(auto)} → ${c.dialog ? 'dialog' : 'no dialog'} expected`);
      const answer: ManualCalibration = { left: 0, right: idle.width, keys: 61, lowest: 48 };
      const prompt = vi.fn(async () => answer);
      const manual = await confirmCalibration(auto, () => ({}) as ImageData, { calibrate: prompt });
      if (c.dialog) {
        if (auto) expect(auto.confidence).toBeLessThan(CONFIDENCE_OK);
        expect(prompt).toHaveBeenCalledTimes(1);
        // The dialog is pre-filled with the automatic guess.
        expect((prompt.mock.calls[0] as unknown[])[1]).toBe(auto);
        expect(manual).toBe(answer);
      } else {
        expect(auto).not.toBeNull();
        expect(auto!.confidence).toBeGreaterThanOrEqual(CONFIDENCE_OK);
        expect(auto!.quality!.issues).toEqual([]);
        expect(prompt).not.toHaveBeenCalled();
        expect(manual).toBeUndefined();
      }
      if (c.range) expect([auto!.low, auto!.high]).toEqual(c.range);
    });
  }

  test('octave ambiguity: only keyboards that fit A0–C8 at a single octave are unambiguous', () => {
    expect(octaveAmbiguous(21, 108)).toBe(false); // 88
    expect(octaveAmbiguous(28, 103)).toBe(false); // 76
    expect(octaveAmbiguous(36, 96)).toBe(true); // 61: C1–C6 and C3–C8 look the same
    expect(octaveAmbiguous(48, 108)).toBe(true);
  });

  test('cropped C3–C8: the dialog answer (61 keys from C3) is what gets used, and it transcribes right', async () => {
    const frameAt = cropped(DARK, 48, 0, null);
    const idle = idleFrame(frameAt);
    const auto = autoCalibrate(idle);
    const prompt = vi.fn(async (): Promise<ManualCalibration> => ({ left: 0, right: idle.width, keys: 61, lowest: 48 }));
    const manual = await confirmCalibration(auto, () => ({}) as ImageData, { calibrate: prompt });
    const run = detectFrames(frameAt, DURATION, manual);
    const visible = ref.notes.filter((n) => n.pitch >= 48);
    const m = noteF1(visible, run.estimate.notes, 0.05);
    report(`[falling-notes confidence] cropped C3–C8 after the dialog: keys ${run.calibration.low}–${run.calibration.high}, F1 ${(m.f1 * 100).toFixed(1)}%`);
    expect([run.calibration.low, run.calibration.high]).toEqual([48, 108]);
    expect(m.f1).toBeGreaterThanOrEqual(0.95);
  });

  test('explicit manual values skip the dialog; alwaysCalibrate opens it even for a full keyboard', async () => {
    const auto = autoCalibrate(idleFrame((t) => renderAt(ref, t, DARK)));
    const prompt = vi.fn(async (): Promise<ManualCalibration> => ({ left: 0, right: 1280, keys: 88 }));
    const given: ManualCalibration = { left: 0, right: 1280, keys: 88 };
    expect(await confirmCalibration(auto, () => ({}) as ImageData, { calibrate: prompt, manual: given })).toBe(given);
    expect(prompt).not.toHaveBeenCalled();
    await confirmCalibration(auto, () => ({}) as ImageData, { calibrate: prompt, alwaysCalibrate: true });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  test('no keyboard found: the dialog opens with no automatic guess', async () => {
    const prompt = vi.fn(async (): Promise<ManualCalibration> => ({ left: 0, right: 320, keys: 88 }));
    await confirmCalibration(null, () => ({}) as ImageData, { calibrate: prompt });
    expect(prompt).toHaveBeenCalledWith(expect.anything(), null);
  });
});
