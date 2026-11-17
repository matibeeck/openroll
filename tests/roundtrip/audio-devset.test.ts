/**
 * Reproduces the dev-set numbers behind DEFAULT_POSTPROCESS (docs/DECISIONS.md, M4).
 * All audio here is SYNTHETIC piano (additive synth in ./synth.ts), not recordings.
 *
 * Default run: the three two-hand dev pieces + the first melody (~45 s on tfjs CPU).
 * AUDIO_DEVSET=full runs all six. The grid search itself: `npm run tune:audio`.
 */
import { beforeAll, describe, expect, test } from 'vitest';
import type { GraphModel } from '@tensorflow/tfjs';
import { decodeNotes, runModel } from '../../src/converters/inputs/audio/basic-pitch-run';
import { cleanEvents } from '../../src/converters/inputs/audio/postprocess';
import { audioDevSet } from '../fixtures/audio-devset';
import { loadBasicPitchModelNode } from './basic-pitch-node';
import { formatMetrics, noteF1, report } from './metrics';
import { synthesizeScore } from './synth';

/** F1 recorded in docs/DECISIONS.md for the defaults on this dev set (round 2: 98.1 → 98.8 two-hand). */
const DOCUMENTED = { monophonic: 1.0, 'two-hand': 0.988 } as const;
/** Allowed drift before this test calls it a regression (platform float differences, etc.). */
const DRIFT = 0.02;

const full = process.env.AUDIO_DEVSET === 'full';
const pieces = audioDevSet().filter((p) => full || p.kind === 'two-hand' || p.name === 'dmono1');
let model: GraphModel;

beforeAll(async () => {
  model = await loadBasicPitchModelNode();
});

describe(`audio dev set (${full ? 'all 6 pieces' : '4 of 6 pieces; AUDIO_DEVSET=full for all'}), synthetic piano`, () => {
  test('dev-set F1 with the default post-processing matches the documented numbers', async () => {
    const f1: Record<'monophonic' | 'two-hand', number[]> = { monophonic: [], 'two-hand': [] };
    for (const p of pieces) {
      const t0 = performance.now();
      const audio = synthesizeScore(p.score, { seed: p.synthSeed });
      const raw = decodeNotes(await runModel(model, audio));
      const rawM = noteF1(p.score.notes, raw, 0.05);
      const m = noteF1(p.score.notes, cleanEvents(raw), 0.05);
      f1[p.kind].push(m.f1);
      report(`[audio-devset] ${formatMetrics(`${p.name} raw`, rawM)}`);
      report(
        `[audio-devset] ${formatMetrics(`${p.name} post-processed`, m)} ` +
          `(${(audio.length / 22050).toFixed(1)} s audio, ${((performance.now() - t0) / 1000).toFixed(1)} s)`,
      );
    }
    for (const kind of ['monophonic', 'two-hand'] as const) {
      const xs = f1[kind];
      if (!xs.length) continue;
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      report(
        `[audio-devset] ${kind}: mean F1 ${(mean * 100).toFixed(1)}% over ${xs.length} piece(s) ` +
          `(documented ${(DOCUMENTED[kind] * 100).toFixed(1)}% on all 3)`,
      );
      expect(mean).toBeGreaterThanOrEqual(DOCUMENTED[kind] - DRIFT);
    }
  });
});
