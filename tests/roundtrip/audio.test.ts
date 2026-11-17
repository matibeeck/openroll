/**
 * Round trip: fixture Score → piano-like synth (22,050 Hz mono) → Basic Pitch (tfjs CPU, model
 * loaded from local files) → post-processing → note F1 (pitch exact, onset ±50 ms).
 * Targets (docs/PLAN.md M4): F1 ≥ 0.85 monophonic, ≥ 0.70 two-hand.
 */
import { beforeAll, describe, expect, test } from 'vitest';
import type { GraphModel } from '@tensorflow/tfjs';
import type { Score } from '../../src/core/score';
import {
  BASIC_PITCH_SAMPLE_RATE,
  decodeNotes,
  runModel,
  TranscriptionCancelled,
} from '../../src/converters/inputs/audio/basic-pitch-run';
import { postprocess } from '../../src/converters/inputs/audio/postprocess';
import { monophonicMelody, twoHandPiece } from '../fixtures/transcription-fixtures';
import { loadBasicPitchModelNode, modelJsonPath } from './basic-pitch-node';
import { formatMetrics, noteF1, report, type NoteMetrics } from './metrics';
import { addReverb, synthesizeScore } from './synth';

const ONSET_TOLERANCE = 0.05;
let model: GraphModel;

beforeAll(async () => {
  const t0 = performance.now();
  model = await loadBasicPitchModelNode();
  report(`[audio] model ${modelJsonPath()} loaded in ${(performance.now() - t0).toFixed(0)} ms`);
});

async function roundTrip(name: string, reference: Score, audio: Float32Array): Promise<{ metrics: NoteMetrics; score: Score }> {
  const t0 = performance.now();
  const out = await runModel(model, audio);
  const raw = decodeNotes(out);
  const score = postprocess(raw, { title: name });
  const ms = performance.now() - t0;
  const rawMetrics = noteF1(reference.notes, raw, ONSET_TOLERANCE);
  const metrics = noteF1(reference.notes, score.notes, ONSET_TOLERANCE);
  const secs = audio.length / BASIC_PITCH_SAMPLE_RATE;
  report(`[audio] ${name}: ${secs.toFixed(1)} s of audio transcribed in ${(ms / 1000).toFixed(1)} s`);
  report(`[audio] ${formatMetrics(`${name} (Basic Pitch raw)`, rawMetrics)}`);
  report(`[audio] ${formatMetrics(`${name} (post-processed)`, metrics)}`);
  if (metrics.missed.length) report(`[audio]   missed: ${fmtNotes(metrics.missed)}`);
  if (metrics.extra.length) report(`[audio]   extra:  ${fmtNotes(metrics.extra)}`);
  return { metrics, score };
}

function fmtNotes(ns: { pitch: number; start: number }[]): string {
  return ns.map((n) => `${n.pitch}@${n.start.toFixed(2)}s`).join(' ');
}

/** Of the matched notes, how many got the same hand as the fixture. */
function handAgreement(reference: Score, estimate: Score): number {
  let same = 0;
  let total = 0;
  for (const e of estimate.notes) {
    const r = reference.notes.find((n) => n.pitch === e.pitch && Math.abs(n.start - e.start) <= ONSET_TOLERANCE);
    if (!r) continue;
    total++;
    if (r.hand === e.hand) same++;
  }
  return total ? same / total : 0;
}

describe('audio → Score round trip (Basic Pitch)', () => {
  test('monophonic melody: F1 ≥ 0.85', async () => {
    const ref = monophonicMelody();
    const { metrics, score } = await roundTrip('monophonic', ref, synthesizeScore(ref, { seed: 1 }));
    expect(score.notes.every((n) => n.hand === 'L' || n.hand === 'R')).toBe(true);
    expect(score.notes.every((n) => n.velocity > 0 && n.velocity <= 1)).toBe(true);
    expect(metrics.f1).toBeGreaterThanOrEqual(0.85);
  });

  test('two-hand piece: F1 ≥ 0.70', async () => {
    const ref = twoHandPiece();
    const { metrics, score } = await roundTrip('two-hand', ref, synthesizeScore(ref, { seed: 2 }));
    report(`[audio] two-hand: hand assignment agrees with the fixture on ${(handAgreement(ref, score) * 100).toFixed(1)}% of matched notes`);
    expect(metrics.f1).toBeGreaterThanOrEqual(0.7);
  });

  test('two-hand piece with sustain pedal, reverb and noise (informational, no PLAN target)', async () => {
    const ref = twoHandPiece();
    // Pedal: every note rings until the next bar line (4 beats at 90 bpm), onsets unchanged.
    const bar = (4 * 60) / 90;
    const pedalled: Score = {
      ...ref,
      notes: ref.notes.map((n) => ({ ...n, duration: Math.max(n.duration, (Math.floor(n.start / bar) + 1) * bar - n.start) })),
    };
    const audio = addReverb(synthesizeScore(pedalled, { seed: 3, noiseFloor: 0.01 }), BASIC_PITCH_SAMPLE_RATE, 1.5, 0.35);
    const { metrics } = await roundTrip('two-hand stress', ref, audio);
    // Reported, not asserted: PLAN.md has no target for this condition. Sanity floor only.
    expect(metrics.f1).toBeGreaterThan(0);
  });

  test('cancel stops inference between windows', async () => {
    const audio = synthesizeScore(monophonicMelody(), { seed: 4 });
    let windows = 0;
    await expect(
      runModel(model, audio, () => windows++, () => windows >= 2),
    ).rejects.toBeInstanceOf(TranscriptionCancelled);
    expect(windows).toBe(2);
  });
});
