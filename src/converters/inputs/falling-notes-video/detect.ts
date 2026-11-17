/**
 * Falling-notes video → notes: pure pixel analysis (no DOM). Runs in the worker and in Node tests.
 *
 * 1. Calibration: find the keyboard in an idle frame (the per-pixel median of a few frames spread
 *    over the video, so lit keys and falling bars mostly vanish):
 *    - black-key band = rows with many dark runs bounded by bright pixels,
 *    - white band = bright rows right below it,
 *    - left/right ends from the white band, then the key range (low/high) that best explains the
 *      measured black-key centers.
 *    A manual calibration (ends + 88/76/61 keys + lowest key) can replace or fix it.
 * 2. Detection: for each frame, the mean color of a small patch per key is compared with that
 *    key's idle color; hysteresis + debounce turn that into note on/off events.
 * 3. Hands: the lit colors are clustered by hue; two clear clusters → left = lower mean pitch.
 */
import { assignHands } from '../../../core/hands';
import { countWhite, isBlack, layoutKeyboard } from '../../../core/keyboard';
import { createScore, type Hand, type Note, type Score } from '../../../core/score';

export interface RgbaFrame {
  width: number;
  height: number;
  /** RGBA, row-major (same layout as ImageData.data). */
  data: Uint8ClampedArray;
}

export type KeyCount = 88 | 76 | 61;
/** Lowest key of the standard keyboard sizes. */
export const STANDARD_LOWEST: Record<KeyCount, number> = { 88: 21, 76: 28, 61: 36 };

export interface Calibration {
  /** Keyboard left and right ends, px (right is exclusive). */
  left: number;
  right: number;
  /** Top of the keys, bottom of the black keys, bottom of the white keys, px. */
  top: number;
  blackBottom: number;
  bottom: number;
  /** MIDI pitch of the leftmost and rightmost keys. */
  low: number;
  high: number;
  /** 0–1. Below CONFIDENCE_OK, ask the user to check the calibration. */
  confidence: number;
  source: 'auto' | 'manual';
  /** Measured black-key centers (pitch → x), used instead of the generic layout when present. */
  blackCenters?: Record<number, number>;
}

/** What a person adjusts in the calibration dialog. */
export interface ManualCalibration {
  left: number;
  right: number;
  keys: KeyCount;
  /** Defaults to the standard lowest key for `keys` (A0, E1, C2). */
  lowest?: number;
  /** Keyboard top/bottom; found automatically between left and right when omitted. */
  top?: number;
  bottom?: number;
}

export const CONFIDENCE_OK = 0.85;

// ---------------------------------------------------------------------------------------------
// Pixel helpers

const BRIGHT = 150;
const DARK = 90;

function lum(d: Uint8ClampedArray, i: number): number {
  return 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
}

/** Per-pixel median of several frames of the same size (removes transient lit keys and bars). */
export function medianFrame(frames: RgbaFrame[]): RgbaFrame {
  const first = frames[0];
  if (!first) throw new Error('medianFrame: no frames');
  if (frames.length === 1) return { width: first.width, height: first.height, data: first.data.slice() };
  const n = frames.length;
  const out = new Uint8ClampedArray(first.data.length);
  const buf = new Array<number>(n);
  const mid = n >> 1;
  for (let i = 0; i < out.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      for (let k = 0; k < n; k++) buf[k] = frames[k]!.data[i + c]!;
      buf.sort((a, b) => a - b);
      out[i + c] = n % 2 ? buf[mid]! : (buf[mid - 1]! + buf[mid]!) / 2;
    }
    out[i + 3] = 255;
  }
  return { width: first.width, height: first.height, data: out };
}

interface RowStats {
  brightFrac: number;
  /** Dark runs bounded by bright pixels on both sides: [start, end). */
  runs: [number, number][];
}

function rowStats(f: RgbaFrame, y: number, x0 = 0, x1 = f.width): RowStats {
  const d = f.data;
  const w = x1 - x0;
  const cls = new Uint8Array(w); // 0 mid, 1 bright, 2 dark
  let bright = 0;
  for (let x = x0; x < x1; x++) {
    const l = lum(d, (y * f.width + x) * 4);
    if (l > BRIGHT) {
      cls[x - x0] = 1;
      bright++;
    } else if (l < DARK) cls[x - x0] = 2;
  }
  const runs: [number, number][] = [];
  const maxLen = Math.max(4, w / 8);
  const neighbor = (from: number, step: number): number => {
    // Skip up to 3 mid pixels (anti-aliased or gap lines), return the class found.
    for (let k = 0, x = from; k < 4 && x >= 0 && x < w; k++, x += step) {
      if (cls[x] !== 0) return cls[x]!;
    }
    return 0;
  };
  let x = 0;
  while (x < w) {
    if (cls[x] !== 2) {
      x++;
      continue;
    }
    const s = x;
    while (x < w && cls[x] === 2) x++;
    const len = x - s;
    if (len >= 2 && len <= maxLen && neighbor(s - 1, -1) === 1 && neighbor(x, 1) === 1) runs.push([s + x0, x + x0]);
  }
  return { brightFrac: w > 0 ? bright / w : 0, runs };
}

// ---------------------------------------------------------------------------------------------
// Calibration

interface Band {
  top: number;
  blackBottom: number;
  bottom: number;
}

/** Finds the keyboard rows: a band of black-key rows directly above a band of bright rows. */
function findKeyboardBand(f: RgbaFrame, x0 = 0, x1 = f.width, minRuns = 5): Band | null {
  const isBlackRow: boolean[] = [];
  const stats: RowStats[] = [];
  for (let y = 0; y < f.height; y++) {
    const s = rowStats(f, y, x0, x1);
    stats.push(s);
    isBlackRow.push(s.runs.length >= minRuns);
  }
  let best: (Band & { score: number }) | null = null;
  let y = 0;
  while (y < f.height) {
    if (!isBlackRow[y]) {
      y++;
      continue;
    }
    const top = y;
    let end = y;
    // Allow single-row breaks (compression noise).
    while (end < f.height && (isBlackRow[end] || (end + 1 < f.height && isBlackRow[end + 1]))) end++;
    y = end;
    const blackH = end - top;
    if (blackH < 3) continue;
    let bottom = end;
    while (bottom < f.height && stats[bottom]!.brightFrac >= 0.6 && stats[bottom]!.runs.length <= 1) bottom++;
    const whiteH = bottom - end;
    if (whiteH < Math.max(2, blackH * 0.15)) continue;
    const score = blackH + whiteH + top * 1e-3; // prefer taller, then lower in the frame
    if (!best || score > best.score) best = { top, blackBottom: end, bottom, score };
  }
  return best && { top: best.top, blackBottom: best.blackBottom, bottom: best.bottom };
}

/** Left/right ends of the bright white-key area on the middle row of the white band. */
function findEnds(f: RgbaFrame, band: Band): { left: number; right: number } | null {
  const y = Math.min(f.height - 1, Math.round((band.blackBottom + band.bottom) / 2));
  const d = f.data;
  const bright = (x: number) => lum(d, (y * f.width + x) * 4) > BRIGHT;
  let left = -1;
  for (let x = 0; x + 2 < f.width; x++) {
    if (bright(x) && bright(x + 1) && bright(x + 2)) {
      left = x;
      break;
    }
  }
  let right = -1;
  for (let x = f.width - 1; x >= 2; x--) {
    if (bright(x) && bright(x - 1) && bright(x - 2)) {
      right = x + 1;
      break;
    }
  }
  if (left < 0 || right - left < f.width * 0.1) return null;
  // A 1 px key-gap line at the outer edge reads as "not bright": include it.
  if (left > 0 && left <= 2) left = 0;
  if (right < f.width && right >= f.width - 2) right = f.width;
  return { left, right };
}

/** Black-key centers measured on the black-key band (the row with the most runs). */
function measureBlackCenters(f: RgbaFrame, band: Band, x0 = 0, x1 = f.width): number[] {
  let best: [number, number][] = [];
  for (const frac of [0.3, 0.45, 0.6, 0.75]) {
    const y = Math.round(band.top + frac * (band.blackBottom - band.top));
    const runs = rowStats(f, Math.min(f.height - 1, y), x0, x1).runs;
    if (runs.length > best.length) best = runs;
  }
  return best.map(([s, e]) => (s + e) / 2);
}

function blackLayoutCenters(left: number, right: number, low: number, high: number): { pitch: number; x: number }[] {
  const layout = layoutKeyboard(right - left, low, high, left);
  return layout.keys.filter((k) => k.black).map((k) => ({ pitch: k.pitch, x: k.x + k.width / 2 }));
}

/** Greedy one-to-one matching of sorted positions within a tolerance. */
function matchSorted(a: number[], b: number[], tol: number): [number, number][] {
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const d = a[i]! - b[j]!;
    if (Math.abs(d) <= tol) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (d < 0) i++;
    else j++;
  }
  return pairs;
}

function nextWhite(p: number): number {
  let q = p + 1;
  while (isBlack(q)) q++;
  return q;
}

interface Fit {
  low: number;
  high: number;
  score: number;
  standard: boolean;
  blackCenters: Record<number, number>;
}

/** Key range (low/high) whose layout best explains the measured black-key centers. */
function fitKeyRange(left: number, right: number, measured: number[]): Fit | null {
  const standards = new Map<string, true>(
    (Object.entries(STANDARD_LOWEST) as [string, number][]).map(([k, low]) => [`${low}-${low + Number(k) - 1}`, true]),
  );
  let best: (Fit & { rank: number }) | null = null;
  for (let low = 21; low <= 96; low++) {
    if (isBlack(low)) continue;
    let high = low;
    let whites = 1;
    while (high < 108) {
      high = nextWhite(high);
      if (high > 108) break;
      whites++;
      if (whites < 7) continue;
      const ww = (right - left) / whites;
      const pred = blackLayoutCenters(left, right, low, high);
      if (pred.length === 0) continue;
      const pairs = matchSorted(
        measured,
        pred.map((p) => p.x),
        0.3 * ww,
      );
      const precision = measured.length ? pairs.length / measured.length : 0;
      const recall = pairs.length / pred.length;
      const score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
      const standard = standards.has(`${low}-${high}`);
      // Octave shifts give the same pattern: prefer standard sizes, then ranges centered near middle C.
      const rank = score + (standard ? 0.02 : 0) - Math.abs((low + high) / 2 - 64) * 1e-4;
      if (!best || rank > best.rank) {
        const blackCenters: Record<number, number> = {};
        for (const [mi, pi] of pairs) blackCenters[pred[pi]!.pitch] = measured[mi]!;
        best = { low, high, score, standard, blackCenters, rank };
      }
    }
  }
  return best && { low: best.low, high: best.high, score: best.score, standard: best.standard, blackCenters: best.blackCenters };
}

/** Automatic calibration from an idle (median) frame. Returns null if no keyboard was found. */
export function autoCalibrate(frame: RgbaFrame): Calibration | null {
  const band = findKeyboardBand(frame);
  if (!band) return null;
  const ends = findEnds(frame, band);
  if (!ends) return null;
  const measured = measureBlackCenters(frame, band, ends.left, ends.right);
  const fit = fitKeyRange(ends.left, ends.right, measured);
  if (!fit) return null;
  return {
    ...ends,
    ...band,
    low: fit.low,
    high: fit.high,
    confidence: fit.score * (fit.standard ? 1 : 0.8),
    source: 'auto',
    blackCenters: fit.blackCenters,
  };
}

/** Highest key of a keyboard with `keys` keys starting at `lowest`. */
export function highestKey(keys: KeyCount, lowest: number): number {
  return Math.min(108, lowest + keys - 1);
}

/** Turns the dialog's values into a full calibration, finding the rows if they were not given. */
export function calibrationFromManual(frame: RgbaFrame, m: ManualCalibration): Calibration {
  const left = Math.max(0, Math.min(m.left, m.right));
  const right = Math.min(frame.width, Math.max(m.left, m.right));
  const low = m.lowest ?? STANDARD_LOWEST[m.keys];
  const high = highestKey(m.keys, low);
  let band: Band | null = null;
  if (m.top === undefined || m.bottom === undefined) band = findKeyboardBand(frame, left, right, 3);
  const top = m.top ?? band?.top ?? Math.round(frame.height * 0.82);
  const bottom = m.bottom ?? band?.bottom ?? frame.height;
  const blackBottom =
    band && m.top === undefined && m.bottom === undefined ? band.blackBottom : Math.round(top + 0.62 * (bottom - top));
  // Snap black keys to what is visible when they line up with the chosen range.
  const measured = measureBlackCenters(frame, { top, blackBottom, bottom }, left, right);
  const pred = blackLayoutCenters(left, right, low, high);
  const ww = (right - left) / Math.max(1, countWhite(low, high));
  const blackCenters: Record<number, number> = {};
  for (const [mi, pi] of matchSorted(
    measured,
    pred.map((p) => p.x),
    0.3 * ww,
  ))
    blackCenters[pred[pi]!.pitch] = measured[mi]!;
  return { left, right, top, blackBottom, bottom, low, high, confidence: 1, source: 'manual', blackCenters };
}

// ---------------------------------------------------------------------------------------------
// Detection

export interface KeySampler {
  pitch: number;
  black: boolean;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** A small patch per key: white keys below the black keys, black keys in their middle. */
export function keySamplers(cal: Calibration): KeySampler[] {
  const layout = layoutKeyboard(cal.right - cal.left, cal.low, cal.high, cal.left);
  const ww = layout.whiteWidth;
  const whiteH = cal.bottom - cal.blackBottom;
  const blackH = cal.blackBottom - cal.top;
  const out: KeySampler[] = [];
  for (const k of layout.keys) {
    if (k.black) {
      const cx = cal.blackCenters?.[k.pitch] ?? k.x + k.width / 2;
      const half = Math.max(0.5, ww * 0.15);
      out.push({
        pitch: k.pitch,
        black: true,
        x0: Math.round(cx - half),
        x1: Math.max(Math.round(cx - half) + 1, Math.round(cx + half)),
        y0: Math.round(cal.top + 0.3 * blackH),
        y1: Math.max(Math.round(cal.top + 0.3 * blackH) + 1, Math.round(cal.top + 0.8 * blackH)),
      });
    } else {
      const cx = k.x + k.width / 2;
      const half = Math.max(0.5, ww * 0.25);
      // White band below the black keys; skip its lower part (key labels live there).
      const y0 = whiteH >= 4 ? cal.blackBottom + 0.15 * whiteH : cal.blackBottom;
      const y1 = whiteH >= 4 ? cal.blackBottom + 0.6 * whiteH : cal.bottom;
      out.push({
        pitch: k.pitch,
        black: false,
        x0: Math.round(cx - half),
        x1: Math.max(Math.round(cx - half) + 1, Math.round(cx + half)),
        y0: Math.round(y0),
        y1: Math.max(Math.round(y0) + 1, Math.round(y1)),
      });
    }
  }
  return out;
}

type Rgb = [number, number, number];

/** Mean color of a sampler's patch. `yOffset` = frame row 0 in calibration coordinates (strips). */
export function patchMean(f: RgbaFrame, s: KeySampler, yOffset = 0): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const x0 = Math.max(0, s.x0);
  const x1 = Math.min(f.width, s.x1);
  const y0 = Math.max(0, s.y0 - yOffset);
  const y1 = Math.min(f.height, s.y1 - yOffset);
  const d = f.data;
  for (let y = y0; y < y1; y++) {
    let i = (y * f.width + x0) * 4;
    for (let x = x0; x < x1; x++, i += 4) {
      r += d[i]!;
      g += d[i + 1]!;
      b += d[i + 2]!;
      n++;
    }
  }
  return n ? [r / n, g / n, b / n] : [0, 0, 0];
}

function dist(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1]! : 0;
}

/** Idle color per key from the idle frame; keys that look lit there fall back to their group's median. */
export function idleColors(frame: RgbaFrame, samplers: KeySampler[], yOffset = 0): Rgb[] {
  const raw = samplers.map((s) => patchMean(frame, s, yOffset));
  const group = (black: boolean): Rgb => {
    const cs = raw.filter((_, i) => samplers[i]!.black === black);
    return [median(cs.map((c) => c[0])), median(cs.map((c) => c[1])), median(cs.map((c) => c[2]))];
  };
  const gw = group(false);
  const gb = group(true);
  return raw.map((c, i) => {
    const g = samplers[i]!.black ? gb : gw;
    return dist(c, g) > 60 ? g : c;
  });
}

export interface DetectOptions {
  /** RGB distance from the idle color that turns a key on / keeps it on (hysteresis). */
  onThreshold: number;
  offThreshold: number;
  /** A lit key whose color jumps this far from the note's color starts a new note (other hand). */
  colorChange: number;
  /** Debounce: frames a key must stay on to count, and off to end a note. */
  minOnFrames: number;
  minOffFrames: number;
}

export const DEFAULT_DETECT: DetectOptions = {
  onThreshold: 60,
  offThreshold: 40,
  colorChange: 90,
  minOnFrames: 1,
  minOffFrames: 1,
};

export interface DetectedNote {
  pitch: number;
  start: number;
  end: number;
  /** Mean lit color. */
  color: Rgb;
}

interface KeyState {
  on: boolean;
  /** Time the current note started (midpoint between the last off frame and the first on frame). */
  start: number;
  onFrames: number;
  offFrames: number;
  /** Time the key was first seen off after being on (pending debounce). */
  offStart: number;
  sum: Rgb;
  n: number;
}

/** Streams frames (or keyboard strips) in time order and emits notes. */
export class KeyTracker {
  private readonly samplers: KeySampler[];
  private readonly idle: Rgb[];
  private readonly opts: DetectOptions;
  private readonly states: KeyState[];
  private readonly notes: DetectedNote[] = [];
  private prevT: number | null = null;
  private lastT = 0;

  constructor(cal: Calibration, idleFrame: RgbaFrame, opts: Partial<DetectOptions> = {}, idleYOffset = 0) {
    this.samplers = keySamplers(cal);
    this.idle = idleColors(idleFrame, this.samplers, idleYOffset);
    this.opts = { ...DEFAULT_DETECT, ...opts };
    this.states = this.samplers.map(() => ({ on: false, start: 0, onFrames: 0, offFrames: 0, offStart: 0, sum: [0, 0, 0], n: 0 }));
  }

  /** `yOffset`: calibration row of the frame's first row (0 for full frames). */
  push(t: number, frame: RgbaFrame, yOffset = 0): void {
    const o = this.opts;
    const edge = this.prevT === null ? t : (this.prevT + t) / 2;
    for (let i = 0; i < this.samplers.length; i++) {
      const c = patchMean(frame, this.samplers[i]!, yOffset);
      const d = dist(c, this.idle[i]!);
      const st = this.states[i]!;
      const lit = st.on ? d > o.offThreshold : d > o.onThreshold;
      if (lit) {
        if (st.on && st.n > 0) {
          const mean: Rgb = [st.sum[0] / st.n, st.sum[1] / st.n, st.sum[2] / st.n];
          if (dist(c, mean) > o.colorChange && st.onFrames >= o.minOnFrames) {
            // Same key re-lit in another color with no gap: a new note.
            this.close(i, edge);
            this.open(st, edge);
          }
        }
        if (!st.on) this.open(st, edge);
        st.offFrames = 0;
        st.onFrames++;
        st.sum[0] += c[0];
        st.sum[1] += c[1];
        st.sum[2] += c[2];
        st.n++;
      } else if (st.on) {
        if (st.offFrames === 0) st.offStart = edge;
        st.offFrames++;
        if (st.offFrames >= o.minOffFrames) this.close(i, st.offStart);
      }
    }
    this.prevT = t;
    this.lastT = t;
  }

  private open(st: KeyState, t: number): void {
    st.on = true;
    st.start = t;
    st.onFrames = 0;
    st.offFrames = 0;
    st.sum = [0, 0, 0];
    st.n = 0;
  }

  private close(i: number, end: number): void {
    const st = this.states[i]!;
    if (st.onFrames >= this.opts.minOnFrames && st.n > 0) {
      this.notes.push({
        pitch: this.samplers[i]!.pitch,
        start: st.start,
        end: Math.max(end, st.start + 1e-3),
        color: [st.sum[0] / st.n, st.sum[1] / st.n, st.sum[2] / st.n],
      });
    }
    st.on = false;
    st.onFrames = 0;
    st.offFrames = 0;
  }

  /** Closes notes still sounding at the last frame and returns all notes sorted by start. */
  finish(): DetectedNote[] {
    for (let i = 0; i < this.states.length; i++) if (this.states[i]!.on) this.close(i, this.lastT);
    return this.notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  }
}

// ---------------------------------------------------------------------------------------------
// Hands and Score

/** Hue/saturation as a 2-D vector (0–255 scale), so lighter/darker shades of one color stay together. */
function hueVector([r, g, b]: Rgb): [number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const c = max - min;
  if (max <= 0 || c === 0) return [0, 0];
  let h: number;
  if (max === r) h = ((g - b) / c) % 6;
  else if (max === g) h = (b - r) / c + 2;
  else h = (r - g) / c + 4;
  const angle = (h / 6) * 2 * Math.PI;
  const s = c / max;
  return [255 * s * Math.cos(angle), 255 * s * Math.sin(angle)];
}

/**
 * Two-cluster split of note colors. Returns a cluster index per note, or null when the colors
 * do not form two clearly separate groups.
 */
export function clusterColors(colors: Rgb[], minSeparation = 70): number[] | null {
  if (colors.length < 2) return null;
  const v = colors.map(hueVector);
  // Farthest-pair initialization.
  let a = 0;
  let b = 0;
  let far = -1;
  for (let i = 0; i < v.length; i++) {
    const d = Math.hypot(v[i]![0] - v[0]![0], v[i]![1] - v[0]![1]);
    if (d > far) {
      far = d;
      a = i;
    }
  }
  far = -1;
  for (let i = 0; i < v.length; i++) {
    const d = Math.hypot(v[i]![0] - v[a]![0], v[i]![1] - v[a]![1]);
    if (d > far) {
      far = d;
      b = i;
    }
  }
  let ca: [number, number] = [...v[a]!];
  let cb: [number, number] = [...v[b]!];
  let labels = new Array<number>(v.length).fill(0);
  for (let iter = 0; iter < 20; iter++) {
    labels = v.map((p) => (Math.hypot(p[0] - ca[0], p[1] - ca[1]) <= Math.hypot(p[0] - cb[0], p[1] - cb[1]) ? 0 : 1));
    const mean = (k: number): [number, number] => {
      const ps = v.filter((_, i) => labels[i] === k);
      return ps.length
        ? [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length]
        : k === 0
          ? ca
          : cb;
    };
    ca = mean(0);
    cb = mean(1);
  }
  const sizes = [labels.filter((l) => l === 0).length, labels.filter((l) => l === 1).length];
  if (Math.min(...sizes) === 0 || Math.hypot(ca[0] - cb[0], ca[1] - cb[1]) < minSeparation) return null;
  return labels;
}

export interface NotesToScoreOptions {
  title: string;
  /** Used when colors do not separate the hands. */
  splitPitch: number;
  velocity: number;
}

/** Detected notes → Score, with hands from color clusters (or assignHands as a fallback). */
export function notesToScore(detected: DetectedNote[], opts: Partial<NotesToScoreOptions> = {}): Score {
  const o: NotesToScoreOptions = { title: 'Falling-notes video', splitPitch: 60, velocity: 0.7, ...opts };
  const kept = detected.filter((d) => d.end > d.start);
  const labels = clusterColors(kept.map((d) => d.color));
  let hands: Hand[] = kept.map(() => null);
  if (labels) {
    const meanPitch = (k: number) => {
      const ps = kept.filter((_, i) => labels[i] === k).map((d) => d.pitch);
      return ps.reduce((s, p) => s + p, 0) / ps.length;
    };
    const leftCluster = meanPitch(0) <= meanPitch(1) ? 0 : 1;
    hands = labels.map((l) => (l === leftCluster ? 'L' : 'R'));
  }
  const notes: Note[] = kept.map((d, i) => ({
    pitch: d.pitch,
    start: Math.round(Math.max(0, d.start) * 1e6) / 1e6,
    duration: Math.round((d.end - Math.max(0, d.start)) * 1e6) / 1e6,
    velocity: o.velocity,
    hand: hands[i]!,
    track: 0,
  }));
  const score = createScore({ title: o.title, notes, tracks: [{ name: 'Piano' }] });
  return labels ? score : assignHands(score, { splitPitch: o.splitPitch });
}
