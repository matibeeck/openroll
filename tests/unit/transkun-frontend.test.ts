/**
 * High-precision (Transkun) mode without the model: the TS mel front end and the semi-CRF Viterbi
 * against the reference tensors of the ONNX export (huggingface.co/TuesdayCrowd/transkun-onnx, MIT;
 * trimmed by scripts/transkun/make-fixtures.mjs), plus the pieces of the segment loop that need no
 * model. The real model runs in tests/roundtrip/transkun.test.ts (opt-in).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { TK_DOWNLOAD_BYTES, TK_TRACKS } from '../../src/converters/inputs/audio/transkun/constants';
import { TranskunFrontEnd } from '../../src/converters/inputs/audio/transkun/frontend';
import { TranskunProgress } from '../../src/converters/inputs/audio/transkun/progress';
import { continuousBernoulliMean, planSegments, resolveOverlapping } from '../../src/converters/inputs/audio/transkun/transcribe';
import { viterbiBackward } from '../../src/converters/inputs/audio/transkun/viterbi';
import { report } from '../roundtrip/metrics';

const DIR = resolve('tests/fixtures/transkun');
const bytes = (name: string) => readFileSync(join(DIR, name));

describe('Transkun front end', () => {
  test('features of the reference audio match the exported featuresBatch [66, 229, 6]', () => {
    const b = bytes('ref3b_audio.i16');
    const i16 = new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2);
    const audio = Float32Array.from(i16, (v) => v / 32768);
    const ref = JSON.parse(bytes('ref3b_features.json').toString()) as { shape: number[]; stride: number; values: number[] };
    const { data, frames } = new TranskunFrontEnd().features([audio]);
    expect(frames).toBe(ref.shape[0]);
    expect(data.length).toBe(ref.shape.reduce((a, x) => a * x, 1));
    let maxErr = 0;
    ref.values.forEach((v, i) => (maxErr = Math.max(maxErr, Math.abs(data[i * ref.stride]! - v))));
    report(`[transkun] front end vs reference features: max |error| ${maxErr.toExponential(2)} over ${ref.values.length} values (range 0–1)`);
    expect(maxErr).toBeLessThan(1e-4);
  });

  test('two identical channels give the mono features (power spectra are averaged)', () => {
    const x = Float32Array.from({ length: 8000 }, (_, i) => Math.sin(i * 0.05) * 0.3);
    const fe = new TranskunFrontEnd();
    const mono = fe.features([x]).data;
    const stereo = fe.features([x, x]).data;
    let maxErr = 0;
    for (let i = 0; i < mono.length; i++) maxErr = Math.max(maxErr, Math.abs(mono[i]! - stereo[i]!));
    expect(maxErr).toBeLessThan(1e-5);
  });
});

describe('Transkun Viterbi (viterbiBackward)', () => {
  const ref = JSON.parse(bytes('ref3c.json').toString()) as {
    T: number;
    tracks: number[];
    intervals: Record<string, [number, number][]>;
    synthetic: Record<string, [number, number][]>;
    forced: { forcedStartPos: number[]; intervals: Record<string, [number, number][]> };
  };

  test('real model scores: same intervals as upstream on the tracks closest to firing', () => {
    const { T, tracks } = ref;
    const K = tracks.length;
    const b = bytes('ref3c_S.f32');
    const tri = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
    const S = new Float32Array(T * T * K).fill(-100); // e < b is never read
    let i = 0;
    tracks.forEach((_, k) => {
      for (let e = 0; e < T; e++) for (let bb = 0; bb <= e; bb++) S[(e * T + bb) * K + k] = tri[i++]!;
    });
    const out = viterbiBackward(S, T, K);
    tracks.forEach((track, k) => expect(out[k], `track ${track}`).toEqual(ref.intervals[track]));
  });

  const synthetic = () => {
    // Same construction as the reference: −5 everywhere, track 5 = (1,3) + (5,5), track 10 = (0,4), track 20 = (2,2).
    const T = 6;
    const S = new Float32Array(T * T * TK_TRACKS).fill(-5);
    const set = (e: number, b: number, k: number, v: number) => (S[(e * T + b) * TK_TRACKS + k] = v);
    set(3, 1, 5, 4);
    set(5, 5, 5, 2);
    set(4, 0, 10, 6);
    set(2, 2, 20, 3);
    return { S, T };
  };
  const nonEmpty = (r: [number, number][][]) => Object.fromEntries(r.flatMap((v, k) => (v.length ? [[String(k), v]] : [])));

  test('synthetic multi-track scores', () => {
    const { S, T } = synthetic();
    expect(nonEmpty(viterbiBackward(S, T, TK_TRACKS))).toEqual(ref.synthetic);
  });

  test('forced start position (segment stitching) skips intervals that begin earlier', () => {
    const { S, T } = synthetic();
    expect(nonEmpty(viterbiBackward(S, T, TK_TRACKS, ref.forced.forcedStartPos))).toEqual(ref.forced.intervals);
  });
});

describe('Transkun decoding helpers', () => {
  test('ContinuousBernoulli mean matches torch (clamped probs, Taylor branch near ½)', () => {
    const logits = [-30, -8, -2.5, -0.3, -0.003, 0, 0.002, 0.7, 3, 12, 40];
    // torch.distributions.ContinuousBernoulli(logits=…).mean, torch 2.13
    const torch = [0.0627258, 0.1246644, 0.3105745, 0.4750376, 0.49975, 0.5, 0.5001667, 0.5578624, 0.7190624, 0.9166113, 0.9372742];
    // torch works in float32; near p = 1 its rounding moves the mean by ~7e−5 (≈ 2 µs of onset).
    logits.forEach((l, i) => expect(Math.abs(continuousBernoulliMean(l) - torch[i]!)).toBeLessThan(1e-4));
  });

  test('segments: 16 s every 8 s over the zero-padded audio, all-padding tail skipped', () => {
    const p = planSegments(24 * 44100);
    expect(p.padSamples).toBe(352800);
    expect(p.stepSamples).toBe(345 * 1024);
    expect(p.segmentSamples).toBe(705600);
    expect(p.startFrame).toBe(344);
    expect(p.lastFrameIdx).toBe(689);
    expect(p.starts).toEqual([0, 1, 2, 3].map((k) => k * 353280));
    expect(planSegments(44100).starts.length).toBe(2);
  });

  test('resolveOverlapping cuts a note at the next onset of the same pitch and drops empty notes', () => {
    const out = resolveOverlapping([
      { start: 0, end: 2, symbol: 60 },
      { start: 1, end: 3, symbol: 60 },
      { start: 1, end: 1, symbol: 62 },
      { start: 0.5, end: 4, symbol: 64 },
    ]);
    expect(out).toEqual([
      { start: 0, end: 1, symbol: 60 },
      { start: 0.5, end: 4, symbol: 64 },
      { start: 1, end: 3, symbol: 60 },
    ]);
  });

  test('download size constants match the shipped files', () => {
    expect(statSync(resolve('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm')).size).toBe(TK_DOWNLOAD_BYTES.wasm);
    for (const [k, f] of [['main', 'transkun.onnx'], ['heads', 'transkun-heads.onnx']] as const) {
      const p = resolve('public/models/transkun', f);
      if (existsSync(p)) expect(statSync(p).size).toBe(TK_DOWNLOAD_BYTES[k]);
    }
  });
});

describe('high-precision progress', () => {
  test('monotonic fraction, download label with megabytes, ends at 1', () => {
    const seen: [number, string][] = [];
    const p = new TranskunProgress((f, label) => seen.push([f, label ?? '']));
    p.reading();
    p.decoding();
    p.plan({ segments: 4, downloadBytes: 86e6, warm: false, gpu: true });
    p.worker('downloading-model', 0.5, 43e6, 86e6);
    p.worker('downloading-model', 1, 86e6, 86e6);
    p.worker('loading-model', 1);
    for (let s = 1; s <= 4; s++) p.worker('transcribing', s / 4, s, 4);
    p.worker('finishing', 0);
    p.done();
    for (let i = 1; i < seen.length; i++) expect(seen[i]![0]).toBeGreaterThanOrEqual(seen[i - 1]![0]);
    expect(seen.map(([, l]) => l)).toContain('downloading-model:43:86');
    expect(seen.at(-1)).toEqual([1, 'post-processing']);
  });

  test('cached model: no download stage in the labels', () => {
    const labels: string[] = [];
    const p = new TranskunProgress((_, label) => labels.push(label ?? ''));
    p.plan({ segments: 2, downloadBytes: 0, warm: false, gpu: false });
    p.worker('downloading-model', 1, 86e6, 86e6);
    expect(labels.some((l) => l.startsWith('downloading-model'))).toBe(false);
  });
});
