/**
 * Audio → notes on recording-like synthetic piano (reverb + noise, sustain pedal, soft playing,
 * all combined): the EVALUATION set of tests/fixtures/audio-realistic.ts, which is never used
 * for tuning (the tuning set is separate: `npm run tune:audio -- realistic`).
 *
 * Still synthetic audio (tests/roundtrip/synth.ts), so it is a robustness check, not a measure
 * of real-recording accuracy. Default run: the hand-written two-hand fixture × 4 variants
 * (~1 min on tfjs CPU). AUDIO_REALISTIC=full runs all 20 evaluation renders.
 * PLAN.md has no target for these conditions; the floors only guard against regressions.
 */
import { beforeAll, describe, expect, test } from 'vitest';
import type { GraphModel } from '@tensorflow/tfjs';
import { decodeNotes, runModel } from '../../src/converters/inputs/audio/basic-pitch-run';
import { cleanEvents } from '../../src/converters/inputs/audio/postprocess';
import { realisticEvaluationSet, renderRealistic, type RealismVariant } from '../fixtures/audio-realistic';
import { loadBasicPitchModelNode } from './basic-pitch-node';
import { formatMetrics, noteF1, report } from './metrics';

/**
 * Regression floors per variant (post-processed F1, two-hand fixture), ~5 pts under the values
 * measured on 2026-11-17 with the round-2 defaults: room 99.4, pedal 96.5, soft 98.8, all 96.3.
 */
const FLOOR: Record<RealismVariant, number> = { room: 0.94, pedal: 0.91, soft: 0.93, all: 0.91 };

const full = process.env.AUDIO_REALISTIC === 'full';
const pieces = realisticEvaluationSet().filter((p) => full || p.name.startsWith('two-hand/'));
let model: GraphModel;

beforeAll(async () => {
  model = await loadBasicPitchModelNode();
});

describe(`audio, recording-like synthetic piano — evaluation set (${full ? 'all 20 renders' : 'two-hand fixture × 4; AUDIO_REALISTIC=full for all'})`, () => {
  for (const p of pieces) {
    test(`${p.name}: post-processed F1 reported${p.name.startsWith('two-hand/') ? ` (floor ${FLOOR[p.variant]})` : ''}`, async () => {
      const audio = renderRealistic(p);
      const raw = decodeNotes(await runModel(model, audio));
      const rawM = noteF1(p.score.notes, raw, 0.05);
      const m = noteF1(p.score.notes, cleanEvents(raw), 0.05);
      report(`[audio-realistic] ${formatMetrics(`${p.name} raw`, rawM)}`);
      report(`[audio-realistic] ${formatMetrics(`${p.name} post-processed`, m)}`);
      if (p.name.startsWith('two-hand/')) expect(m.f1).toBeGreaterThanOrEqual(FLOOR[p.variant]);
    });
  }
});
