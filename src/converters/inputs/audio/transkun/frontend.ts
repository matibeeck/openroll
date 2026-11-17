/**
 * Transkun's mel front end in plain TypeScript (no DOM, no onnxruntime): one model segment of audio
 * → `featuresBatch` [T, 229, 6] for transkun.onnx.
 *
 * Port of transkun 2.0.1 (MIT, © 2021 Yujia Yan): `Util.makeFrame`, the gain normalization of
 * `TransKun.processFramesBatch` and `Util.MelSpectrum` / `Util.Spectrum`:
 *   frames (4096, hop 1024, half-window left padding) → (x − mean) / (std + 1e−8) over the whole
 *   segment → × 6 windows (Hann + 5 learned Gaussians) → rfft (ortho) → |·|² → mean over audio
 *   channels → mel (torchaudio `melscale_fbanks`, HTK, 30–8000 Hz, no norm) → (ln(mel + ε) − ln ε) / −ln ε.
 * Checked against the reference tensors of the ONNX export in tests/unit/transkun-frontend.test.ts.
 */
import {
  TK_EPS,
  TK_F_MAX,
  TK_F_MIN,
  TK_GAUSS_CENTER_LOGITS,
  TK_GAUSS_SIGMA_LOGITS,
  TK_HOP,
  TK_MELS,
  TK_SAMPLE_RATE,
  TK_WINDOW,
  TK_WINDOWS,
} from './constants';

const N = TK_WINDOW;
const BINS = N / 2 + 1;

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** The 6 analysis windows, row-major [6, 4096] (row 0: periodic Hann, as torch.hann_window). */
export function analysisWindows(): Float64Array[] {
  const rows: Float64Array[] = [];
  const hann = new Float64Array(N);
  for (let n = 0; n < N; n++) hann[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N);
  rows.push(hann);
  for (let i = 0; i < TK_GAUSS_SIGMA_LOGITS.length; i++) {
    const sigma = sigmoid(TK_GAUSS_SIGMA_LOGITS[i]!);
    const center = sigmoid(TK_GAUSS_CENTER_LOGITS[i]!);
    const w = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      const z = (n - N * center) / ((sigma * N) / 2);
      w[n] = Math.exp(-0.5 * z * z);
    }
    rows.push(w);
  }
  return rows;
}

/** One mel filter as a run of non-zero weights over FFT bins [start, start + weights.length). */
export interface MelFilter {
  start: number;
  weights: Float64Array;
}

const hzToMel = (f: number) => 2595 * Math.log10(1 + f / 700);
const melToHz = (m: number) => 700 * (10 ** (m / 2595) - 1);

/**
 * torchaudio.functional.melscale_fbanks(n_freqs 2049, f_min 30, f_max 8000, n_mels 229,
 * sample_rate 44100, norm None, mel_scale 'htk') as sparse rows (one per mel band).
 */
export function melFilters(): MelFilter[] {
  const nyquist = Math.floor(TK_SAMPLE_RATE / 2);
  const freqs = Array.from({ length: BINS }, (_, i) => (nyquist * i) / (BINS - 1));
  const mMin = hzToMel(TK_F_MIN);
  const mMax = hzToMel(TK_F_MAX);
  const fPts = Array.from({ length: TK_MELS + 2 }, (_, i) => melToHz(mMin + ((mMax - mMin) * i) / (TK_MELS + 1)));
  const filters: MelFilter[] = [];
  for (let m = 0; m < TK_MELS; m++) {
    const lo = fPts[m]!;
    const mid = fPts[m + 1]!;
    const hi = fPts[m + 2]!;
    const vals: number[] = [];
    let start = -1;
    for (let f = 0; f < BINS; f++) {
      const down = (freqs[f]! - lo) / (mid - lo);
      const up = (hi - freqs[f]!) / (hi - mid);
      const w = Math.max(0, Math.min(down, up));
      if (w > 0) {
        if (start < 0) start = f;
        vals[f - start] = w;
      } else if (start >= 0) break;
    }
    filters.push({ start: Math.max(0, start), weights: Float64Array.from(vals.map((v) => v ?? 0)) });
  }
  return filters;
}

/** In-place iterative radix-2 complex FFT of size N (twiddles and bit reversal precomputed). */
class Fft {
  private readonly cos = new Float64Array(N / 2);
  private readonly sin = new Float64Array(N / 2);
  private readonly rev = new Uint16Array(N);

  constructor() {
    for (let i = 0; i < N / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / N);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / N);
    }
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  run(re: Float64Array, im: Float64Array): void {
    const { rev, cos, sin } = this;
    for (let i = 0; i < N; i++) {
      const j = rev[i]!;
      if (j > i) {
        let t = re[i]!;
        re[i] = re[j]!;
        re[j] = t;
        t = im[i]!;
        im[i] = im[j]!;
        im[j] = t;
      }
    }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1;
      const step = N / size;
      for (let start = 0; start < N; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step]!;
          const wi = sin[k * step]!;
          const a = start + k;
          const b = a + half;
          const xr = re[b]! * wr - im[b]! * wi;
          const xi = re[b]! * wi + im[b]! * wr;
          re[b] = re[a]! - xr;
          im[b] = im[a]! - xi;
          re[a] = re[a]! + xr;
          im[a] = im[a]! + xi;
        }
      }
    }
  }
}

/** Number of frames `makeFrame` cuts from `samples` samples (half-window padding on both sides). */
export function frameCount(samples: number): number {
  return Math.ceil(samples / TK_HOP) + 1;
}

/** Reusable front end (windows, mel filters, FFT tables and scratch buffers built once). */
export class TranskunFrontEnd {
  private readonly windows = analysisWindows();
  private readonly filters = melFilters();
  private readonly fft = new Fft();
  private readonly re = new Float64Array(N);
  private readonly im = new Float64Array(N);
  private readonly power = new Float64Array(TK_WINDOWS * BINS);

  /**
   * Features of one segment. `channels` are the segment's samples at 44,100 Hz, one array per
   * audio channel, all of the same length (the caller pads the last segment with zeros).
   * Returns [T, 229, 6] row-major, T = frameCount(length).
   */
  features(channels: Float32Array[]): { data: Float32Array; frames: number } {
    const len = channels[0]?.length ?? 0;
    const frames = frameCount(len);
    const C = channels.length;
    const lPad = N / 2;

    // Gain normalization over every sample of every frame (frames overlap, so samples count as often as
    // they appear), like torch.mean / torch.std (unbiased) over [channel, frame, sample].
    let sum = 0;
    let sumSq = 0;
    for (const x of channels) {
      // Prefix sums make each frame's sum O(1).
      const p1 = new Float64Array(len + 1);
      const p2 = new Float64Array(len + 1);
      for (let i = 0; i < len; i++) {
        const v = x[i]!;
        p1[i + 1] = p1[i]! + v;
        p2[i + 1] = p2[i]! + v * v;
      }
      for (let f = 0; f < frames; f++) {
        const a = Math.min(len, Math.max(0, f * TK_HOP - lPad));
        const b = Math.min(len, Math.max(0, f * TK_HOP - lPad + N));
        sum += p1[b]! - p1[a]!;
        sumSq += p2[b]! - p2[a]!;
      }
    }
    const count = C * frames * N;
    const mean = sum / count;
    const variance = Math.max(0, (sumSq - (sum * sum) / count) / Math.max(1, count - 1));
    const inv = 1 / (Math.sqrt(variance) + 1e-8);

    const out = new Float32Array(frames * TK_MELS * TK_WINDOWS);
    const { re, im, power, windows, filters } = this;
    const scale = 1 / N; // |rfft(·, norm='ortho')|² = |FFT|² / N
    const logEps = Math.log(TK_EPS);
    for (let f = 0; f < frames; f++) {
      power.fill(0);
      const off = f * TK_HOP - lPad;
      for (const x of channels) {
        // Two real windows per complex FFT: z = a + i·b → A[k] = (Z[k] + Z*[N−k]) / 2, B[k] = (Z[k] − Z*[N−k]) / 2i.
        for (let w = 0; w < TK_WINDOWS; w += 2) {
          const wa = windows[w]!;
          const wb = windows[w + 1]!;
          for (let n = 0; n < N; n++) {
            const i = off + n;
            const v = i >= 0 && i < len ? (x[i]! - mean) * inv : -mean * inv;
            re[n] = v * wa[n]!;
            im[n] = v * wb[n]!;
          }
          this.fft.run(re, im);
          const pa = w * BINS;
          const pb = (w + 1) * BINS;
          for (let k = 0; k < BINS; k++) {
            const j = (N - k) % N;
            const ar = (re[k]! + re[j]!) / 2;
            const ai = (im[k]! - im[j]!) / 2;
            const br = (im[k]! + im[j]!) / 2;
            const bi = (re[j]! - re[k]!) / 2;
            power[pa + k] = power[pa + k]! + ((ar * ar + ai * ai) * scale) / C;
            power[pb + k] = power[pb + k]! + ((br * br + bi * bi) * scale) / C;
          }
        }
      }
      const base = f * TK_MELS * TK_WINDOWS;
      for (let m = 0; m < TK_MELS; m++) {
        const { start, weights } = filters[m]!;
        for (let w = 0; w < TK_WINDOWS; w++) {
          const p = w * BINS + start;
          let mel = 0;
          for (let k = 0; k < weights.length; k++) mel += power[p + k]! * weights[k]!;
          out[base + m * TK_WINDOWS + w] = (Math.log(mel + TK_EPS) - logEps) / -logEps;
        }
      }
    }
    return { data: out, frames };
  }
}
