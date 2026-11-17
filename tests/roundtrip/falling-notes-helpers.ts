/**
 * Helpers for falling-notes recognition tests: render fixture Scores to RGBA frames with the
 * app's own renderer (software rasterizer) and run the same pipeline as the browser converter:
 * median of 9 frames → calibration → keyboard strips at 30 fps → KeyTracker → notesToScore.
 */
import { RasterContext } from '../../src/core/raster';
import { renderFrame, type RenderOptions } from '../../src/core/render';
import { scoreDuration, type Score } from '../../src/core/score';
import {
  autoCalibrate,
  calibrationFromManual,
  KeyTracker,
  medianFrame,
  notesToScore,
  type Calibration,
  type ManualCalibration,
  type RgbaFrame,
} from '../../src/converters/inputs/falling-notes-video/detect';

export const FPS = 30;
export const CALIBRATION_FRAMES = 9;

export type RenderSpec = Partial<RenderOptions> & { width: number; height: number };

export function renderAt(score: Score, t: number, o: RenderSpec): RgbaFrame {
  const ctx = new RasterContext(o.width, o.height);
  renderFrame(ctx, score, t, o);
  return { width: o.width, height: o.height, data: ctx.data };
}

export function cropRows(f: RgbaFrame, y0: number, y1: number): RgbaFrame {
  const a = Math.max(0, Math.floor(y0));
  const b = Math.min(f.height, Math.ceil(y1));
  return { width: f.width, height: b - a, data: f.data.slice(a * f.width * 4, b * f.width * 4) };
}

/** Copies a rectangle of `f` into a new `w`×`h` frame filled with `bg`, at (dx, dy). */
export function placeInFrame(
  f: RgbaFrame,
  src: { x: number; y: number; w: number; h: number },
  w: number,
  h: number,
  dx: number,
  dy: number,
  bg: [number, number, number],
): RgbaFrame {
  const out = new Uint8ClampedArray(w * h * 4);
  new Uint32Array(out.buffer).fill(new Uint32Array(new Uint8ClampedArray([bg[0], bg[1], bg[2], 255]).buffer)[0]!);
  const xa = Math.max(0, dx);
  const xb = Math.min(w, dx + src.w);
  if (xb <= xa) return { width: w, height: h, data: out };
  for (let y = 0; y < src.h; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= h) continue;
    const si = ((src.y + y) * f.width + src.x + (xa - dx)) * 4;
    out.set(f.data.subarray(si, si + (xb - xa) * 4), (ty * w + xa) * 4);
  }
  return { width: w, height: h, data: out };
}

/** Deterministic ±amp noise on every channel (stand-in for compression artifacts). */
export function addNoise(f: RgbaFrame, amp: number, seed: number): RgbaFrame {
  let s = seed >>> 0;
  const d = f.data.slice();
  for (let i = 0; i < d.length; i++) {
    if ((i & 3) === 3) continue;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    d[i] = d[i]! + ((s / 4294967296) * 2 - 1) * amp;
  }
  return { ...f, data: d };
}

export interface DetectRun {
  estimate: Score;
  /** Calibration actually used. */
  calibration: Calibration;
  /** What auto calibration found on the idle frame (null = no keyboard). */
  auto: Calibration | null;
}

/**
 * Runs the recognizer on frames produced by `frameAt(t, k)`. Uses auto calibration unless
 * `manual` is given (the dialog's values).
 */
export function detectFrames(
  frameAt: (t: number, k: number) => RgbaFrame,
  duration: number,
  manual?: ManualCalibration,
): DetectRun {
  const calFrames: RgbaFrame[] = [];
  for (let i = 0; i < CALIBRATION_FRAMES; i++) calFrames.push(frameAt(((i + 0.5) / CALIBRATION_FRAMES) * duration, 10_000 + i));
  const idle = medianFrame(calFrames);
  const auto = autoCalibrate(idle);
  const cal = manual ? calibrationFromManual(idle, manual) : auto;
  if (!cal) throw new Error('auto calibration found no keyboard');
  const tracker = new KeyTracker(cal, idle);
  const n = Math.ceil(duration * FPS);
  for (let k = 0; k <= n; k++) {
    const t = k / FPS;
    tracker.push(t, cropRows(frameAt(t, k), cal.top, cal.bottom), Math.floor(cal.top));
  }
  return { estimate: notesToScore(tracker.finish()), calibration: cal, auto };
}

export function detectFromRenders(score: Score, render: RenderSpec, noise = 0): DetectRun {
  return detectFrames(
    (t, k) => {
      const f = renderAt(score, t, render);
      return noise ? addNoise(f, noise, k + 1) : f;
    },
    scoreDuration(score) + 0.5,
  );
}

export function handAccuracy(ref: Score, est: Score, tol = 0.05): number {
  let same = 0;
  let total = 0;
  for (const e of est.notes) {
    const r = ref.notes.find((n) => n.pitch === e.pitch && Math.abs(n.start - e.start) <= tol);
    if (!r) continue;
    total++;
    if (r.hand === e.hand) same++;
  }
  return total ? same / total : 0;
}
