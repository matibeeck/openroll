/**
 * Helpers for falling-notes recognition tests: render fixture Scores to RGBA frames with the
 * app's own renderer (software rasterizer) and run the same pipeline as the browser converter:
 * median of 9 frames → calibration → keyboard strips at 30 fps → KeyTracker → notesToScore.
 */
import { RasterContext } from '../../src/core/raster';
import { parseColor } from '../../src/core/raster';
import { DEFAULT_RENDER_OPTIONS, frameGeometry, renderFrame, type RenderOptions } from '../../src/core/render';
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

/** Extra per-frame processing applied after rendering (e.g. lossy degradation, restyling). */
export type FrameTransform = (f: RgbaFrame, t: number, k: number) => RgbaFrame;

export function detectFromRenders(
  score: Score,
  render: RenderSpec,
  opts: { noise?: number; post?: FrameTransform[] } = {},
): DetectRun {
  return detectFrames(
    (t, k) => {
      let f = renderAt(score, t, render);
      for (const post of opts.post ?? []) f = post(f, t, k);
      return opts.noise ? addNoise(f, opts.noise, k + 1) : f;
    },
    scoreDuration(score) + 0.5,
  );
}

// ---------------------------------------------------------------------------------------------
// Closer-to-real-video degradations (third-party videos are re-encoded, scaled and styled).

/**
 * Lossy-video stand-in: 2× box downscale + bilinear upscale (blur), 4:2:0 chroma subsampling
 * (color averaged over 2×2 blocks, as in H.264/VP9), quantization (luma step `yStep`, chroma
 * step 2×) and ±`noise` dither.
 */
export function lossy(yStep = 6, noise = 4): FrameTransform {
  return (f, _t, k) => {
    const { width: w, height: h, data: src } = f;
    const hw = Math.ceil(w / 2);
    const hh = Math.ceil(h / 2);
    // 2× box downscale (edge pixels replicated for odd sizes).
    const small = new Float32Array(hw * hh * 3);
    for (let y = 0; y < hh; y++) {
      const ya = 2 * y;
      const yb = Math.min(h - 1, ya + 1);
      for (let x = 0; x < hw; x++) {
        const xa = 2 * x;
        const xb = Math.min(w - 1, xa + 1);
        const i00 = (ya * w + xa) * 4;
        const i01 = (ya * w + xb) * 4;
        const i10 = (yb * w + xa) * 4;
        const i11 = (yb * w + xb) * 4;
        const o = (y * hw + x) * 3;
        for (let c = 0; c < 3; c++) small[o + c] = (src[i00 + c]! + src[i01 + c]! + src[i10 + c]! + src[i11 + c]!) / 4;
      }
    }
    // Bilinear upscale, then RGB → YCbCr.
    const Y = new Float32Array(w * h);
    const Cb = new Float32Array(w * h);
    const Cr = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(hh - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const y0 = Math.floor(sy);
      const y1 = Math.min(hh - 1, y0 + 1);
      const fy = sy - y0;
      for (let x = 0; x < w; x++) {
        const sx = Math.min(hw - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
        const x0 = Math.floor(sx);
        const x1 = Math.min(hw - 1, x0 + 1);
        const fx = sx - x0;
        const a = (y0 * hw + x0) * 3;
        const b = (y0 * hw + x1) * 3;
        const c = (y1 * hw + x0) * 3;
        const d = (y1 * hw + x1) * 3;
        const w00 = (1 - fy) * (1 - fx);
        const w01 = (1 - fy) * fx;
        const w10 = fy * (1 - fx);
        const w11 = fy * fx;
        const r = w00 * small[a]! + w01 * small[b]! + w10 * small[c]! + w11 * small[d]!;
        const g = w00 * small[a + 1]! + w01 * small[b + 1]! + w10 * small[c + 1]! + w11 * small[d + 1]!;
        const bl = w00 * small[a + 2]! + w01 * small[b + 2]! + w10 * small[c + 2]! + w11 * small[d + 2]!;
        const i = y * w + x;
        Y[i] = 0.299 * r + 0.587 * g + 0.114 * bl;
        Cb[i] = -0.1687 * r - 0.3313 * g + 0.5 * bl;
        Cr[i] = 0.5 * r - 0.4187 * g - 0.0813 * bl;
      }
    }
    // 4:2:0 chroma (one Cb/Cr per 2×2 block), quantization and dither.
    let seed = (k + 7) >>> 0;
    const out = new Uint8ClampedArray(src.length);
    const cStep = yStep * 2;
    for (let y = 0; y < h; y += 2) {
      const y2 = Math.min(h - 1, y + 1);
      for (let x = 0; x < w; x += 2) {
        const x2 = Math.min(w - 1, x + 1);
        const p = [y * w + x, y * w + x2, y2 * w + x, y2 * w + x2];
        const cb = Math.round((Cb[p[0]!]! + Cb[p[1]!]! + Cb[p[2]!]! + Cb[p[3]!]!) / 4 / cStep) * cStep;
        const cr = Math.round((Cr[p[0]!]! + Cr[p[1]!]! + Cr[p[2]!]! + Cr[p[3]!]!) / 4 / cStep) * cStep;
        for (const i of p) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          const yy = Math.round(Y[i]! / yStep) * yStep + ((seed / 4294967296) * 2 - 1) * noise;
          const o = i * 4;
          out[o] = yy + 1.402 * cr;
          out[o + 1] = yy - 0.3441 * cb - 0.7141 * cr;
          out[o + 2] = yy + 1.772 * cb;
          out[o + 3] = 255;
        }
      }
    }
    return { width: w, height: h, data: out };
  };
}

/**
 * Restyles the keyboard the way other falling-notes apps draw it, by post-processing our frame:
 * idle keys get vertical shading; lit keys (pixels still in the flat hand color) become a
 * top-light/bottom-dark gradient of the hand color with a pale highlight strip on top, lit black
 * keys are darkened; a glow of the hand color rises above the hit line over each lit key.
 */
export function shadedKeysWithGlow(render: RenderSpec): FrameTransform {
  const o = { ...DEFAULT_RENDER_OPTIONS, ...render };
  const { kbTop, kbH, blackH } = frameGeometry(o);
  const hands = [o.handColors.L, o.handColors.R, o.handColors.none].map(parseColor);
  const GLOW = Math.max(6, Math.round(o.height * 0.035));
  return (f) => {
    const { width: w, height: h } = f;
    const d = f.data.slice();
    const litColorAt = (i: number) =>
      hands.find((c) => d[i] === c[0] && d[i + 1] === c[1] && d[i + 2] === c[2]);
    const glowColumn: ([number, number, number] | undefined)[] = new Array(w);
    for (let y = kbTop; y < h; y++) {
      const rel = (y - kbTop) / Math.max(1, kbH); // 0 top … 1 bottom
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const lit = litColorAt(i);
        if (lit) {
          // Lit pixels in the black-key rows (black keys, and white keys between them) are darker.
          const inBlackRows = y < kbTop + blackH;
          const shade = (inBlackRows ? 0.8 : 1) * (1.12 - 0.45 * rel);
          const highlight = y - kbTop < 3 ? 0.45 : 0;
          for (let c = 0; c < 3; c++) d[i + c] = (lit[c]! * shade) * (1 - highlight) + 255 * highlight;
          if (y === kbTop + 1) glowColumn[x] = lit;
        } else {
          const shade = 1 - 0.15 * rel; // idle keys: lighter at the top
          for (let c = 0; c < 3; c++) d[i + c] = d[i + c]! * shade;
        }
      }
    }
    // Glow above the hit line.
    for (let x = 0; x < w; x++) {
      const g = glowColumn[x];
      if (!g) continue;
      for (let dy = 3; dy < GLOW + 3; dy++) {
        const y = kbTop - dy;
        if (y < 0) break;
        const a = 0.7 * (1 - (dy - 3) / GLOW);
        const i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) d[i + c] = d[i + c]! * (1 - a) + Math.min(255, g[c]! * 1.3) * a;
      }
    }
    return { width: w, height: h, data: d };
  };
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
