/**
 * High-precision mode (Transkun) with the real model — OPT-IN, it needs the 57 MB model in
 * public/models/transkun (scripts/fetch-transkun.mjs) and ~2–3 s of CPU per 16 s segment:
 *
 *   TRANSKUN=1 npx vitest run tests/roundtrip/transkun.test.ts      upstream parity + 4 evaluation renders
 *   TRANSKUN=full npx vitest run tests/roundtrip/transkun.test.ts   all 20 evaluation renders
 *
 * 1. Parity with upstream: the PyTorch `transkun` 2.0.1 CLI pipeline (scripts/transkun/python_reference.py)
 *    on a generated two-hand piece with sustain pedal, 3 segments long, vs our TS front end + ONNX +
 *    Viterbi + stitching + heads. Reference events: tests/fixtures/transkun/python-reference.json.
 *    TRANSKUN_WRITE_AUDIO=path writes that piece as raw float32 for the Python script.
 * 2. Note F1 (pitch exact, onset ±50 ms) on the recording-like EVALUATION set of
 *    tests/fixtures/audio-realistic.ts (22,050 Hz renders, upsampled to the model's 44.1 kHz).
 *    Nothing in this mode was tuned on any set: Transkun runs with upstream's decoding as is.
 * The fast unit checks of the front end and Viterbi run by default (tests/unit/transkun-frontend.test.ts).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import type { Score } from '../../src/core/score';
import { TK_SAMPLE_RATE } from '../../src/converters/inputs/audio/transkun/constants';
import { transkunToScore } from '../../src/converters/inputs/audio/transkun/to-score';
import { transcribeTranskun, type TranskunEvent, type TranskunModel } from '../../src/converters/inputs/audio/transkun/transcribe';
import { devTwoHand } from '../fixtures/audio-devset';
import { realisticEvaluationSet, renderRealistic } from '../fixtures/audio-realistic';
import { formatMetrics, noteF1, report } from './metrics';
import { sustainPedal, synthesizeScore } from './synth';
import { loadTranskunNode, transkunInstalled } from './transkun-node';

const mode = process.env.TRANSKUN;
const enabled = mode === '1' || mode === 'full';
const installed = transkunInstalled();
const skipReason = !enabled
  ? 'opt-in: set TRANSKUN=1 (or full)'
  : !installed
    ? 'model missing: run node scripts/fetch-transkun.mjs'
    : '';
if (skipReason) report(`[transkun] round-trip skipped (${skipReason})`);

/** Parity piece: dev-style two-hand piece (seed 301, not in any tuning or evaluation set) with pedal. */
function parityAudio(): { audio: Float32Array; score: Score } {
  const score = devTwoHand(301);
  const audio = synthesizeScore(sustainPedal(score), { sampleRate: TK_SAMPLE_RATE, seed: 301, resonance: 0.6 });
  return { audio, score };
}

/** 2× band-limited upsampling (Lanczos, a = 8): 22,050 → 44,100 Hz, as a browser resampler would. */
export function upsample2x(x: Float32Array): Float32Array {
  const A = 8;
  const L = (t: number) => (t === 0 ? 1 : Math.abs(t) >= A ? 0 : (A * Math.sin(Math.PI * t) * Math.sin((Math.PI * t) / A)) / (Math.PI * Math.PI * t * t));
  const half = Array.from({ length: 2 * A }, (_, k) => L(k - A + 1 - 0.5));
  const out = new Float32Array(x.length * 2);
  for (let n = 0; n < x.length; n++) {
    out[2 * n] = x[n]!;
    let s = 0;
    for (let k = 0; k < 2 * A; k++) {
      const m = n - A + 1 + k;
      if (m >= 0 && m < x.length) s += x[m]! * half[k]!;
    }
    out[2 * n + 1] = s;
  }
  return out;
}

describe.skipIf(!!skipReason)('audio → notes, high-precision mode (Transkun, real model)', () => {
  let model: TranskunModel;
  beforeAll(async () => {
    model = await loadTranskunNode();
  });

  test('matches the upstream PyTorch pipeline on a 3-segment piece with pedal', async () => {
    const { audio, score } = parityAudio();
    if (process.env.TRANSKUN_WRITE_AUDIO) {
      writeFileSync(process.env.TRANSKUN_WRITE_AUDIO, Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength));
      report(`[transkun] wrote ${audio.length} samples to ${process.env.TRANSKUN_WRITE_AUDIO}`);
    }
    const ref = JSON.parse(readFileSync(resolve('tests/fixtures/transkun/python-reference.json'), 'utf8')) as {
      samples: number;
      events: TranskunEvent[];
    };
    expect(audio.length).toBe(ref.samples);
    const t0 = performance.now();
    const got = await transcribeTranskun([audio], model);
    const ms = performance.now() - t0;

    // Same events in the same order: symbol exact, times within 1 ms, velocity within 1.
    let maxStart = 0;
    let maxEnd = 0;
    let maxVel = 0;
    expect(got.map((e) => e.symbol)).toEqual(ref.events.map((e) => e.symbol));
    got.forEach((e, i) => {
      const r = ref.events[i]!;
      maxStart = Math.max(maxStart, Math.abs(e.start - r.start));
      maxEnd = Math.max(maxEnd, Math.abs(e.end - r.end));
      maxVel = Math.max(maxVel, Math.abs(e.velocity - r.velocity));
    });
    const notes = got.filter((e) => e.symbol > 0);
    report(
      `[transkun] parity with upstream PyTorch: ${got.length} events (${notes.length} notes, ${got.length - notes.length} pedal) identical; ` +
        `max |Δonset| ${(maxStart * 1000).toFixed(3)} ms, |Δoffset| ${(maxEnd * 1000).toFixed(3)} ms, |Δvelocity| ${maxVel} ` +
        `(${(audio.length / TK_SAMPLE_RATE).toFixed(1)} s audio in ${(ms / 1000).toFixed(1)} s, onnxruntime-web WASM in Node)`,
    );
    expect(maxStart).toBeLessThan(0.001);
    expect(maxEnd).toBeLessThan(0.001);
    expect(maxVel).toBeLessThanOrEqual(1);
    const m = noteF1(score.notes, transkunToScore(got).notes, 0.05);
    report(`[transkun] ${formatMetrics('parity piece (clean synth + pedal) vs its score', m)}`);
  });

  test('all-zero segments decode no interval (so the trailing padding segment can be skipped)', async () => {
    // One segment of silence: the first segment of a silent file is 8 s of padding + 8 s of zeros.
    const events = await transcribeTranskun([new Float32Array(8 * TK_SAMPLE_RATE)], model);
    expect(events).toEqual([]);
  });

  const full = mode === 'full';
  const pieces = realisticEvaluationSet().filter((p) => full || p.name.startsWith('two-hand/'));
  const results: { name: string; kind: string; f1: number }[] = [];
  for (const p of pieces) {
    test(`evaluation ${p.name}: note F1 reported (PLAN.md M4 floor ${p.kind === 'monophonic' ? 0.85 : 0.7})`, async () => {
      const audio = upsample2x(renderRealistic(p));
      const score = transkunToScore(await transcribeTranskun([audio], model));
      const m = noteF1(p.score.notes, score.notes, 0.05);
      results.push({ name: p.name, kind: p.kind, f1: m.f1 });
      report(`[transkun-realistic] ${formatMetrics(p.name, m)}`);
      expect(m.f1).toBeGreaterThanOrEqual(p.kind === 'monophonic' ? 0.85 : 0.7);
    });
  }
  test('evaluation summary', () => {
    if (!results.length) return;
    const mean = results.reduce((s, r) => s + r.f1, 0) / results.length;
    report(`[transkun-realistic] mean note F1 over ${results.length} evaluation renders: ${(mean * 100).toFixed(1)}%`);
  });
});
