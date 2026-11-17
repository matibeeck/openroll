/**
 * Grid search that chose DEFAULT_POSTPROCESS (M4). Skipped unless TUNE=1; run it with
 * `npm run tune:audio` (scripts/tune-audio-postprocess.mjs).
 *
 * TUNE_SET=realistic (`npm run tune:audio -- realistic`) ranks the same grid on the recording-like
 * TUNING set (tests/fixtures/audio-realistic.ts: dev pieces × room/pedal/soft/all) and prints the
 * clean dev set next to it. With EVAL=1 it then reports the separate EVALUATION set for the shipped
 * defaults and for the tuning set's best config — reporting only; the choice is made before.
 *
 * Tunes on the seeded dev set (tests/fixtures/audio-devset.ts), then reports the held-out test
 * fixtures (tests/fixtures/transcription-fixtures.ts) for the shipped defaults. All audio is
 * SYNTHETIC piano. Network activations are cached in the OS temp dir, so re-runs only redo
 * the cheap decoding + post-processing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'vitest';
import type { Score } from '../../src/core/score';
import {
  decodeNotes,
  DEFAULT_DECODE_PARAMS,
  runModel,
  type ModelOutput,
} from '../../src/converters/inputs/audio/basic-pitch-run';
import {
  cleanEvents,
  DEFAULT_POSTPROCESS,
  type RawNoteEvent,
} from '../../src/converters/inputs/audio/postprocess';
import { audioDevSet } from '../fixtures/audio-devset';
import {
  realisticEvaluationSet,
  realisticTuningSet,
  renderRealistic,
  type RealisticPiece,
} from '../fixtures/audio-realistic';
import { monophonicMelody, twoHandPiece } from '../fixtures/transcription-fixtures';
import { loadBasicPitchModelNode } from './basic-pitch-node';
import { noteF1, report } from './metrics';
import { synthesizeScore } from './synth';

const CACHE = join(tmpdir(), 'openroll-tune');

interface Piece {
  name: string;
  kind: 'monophonic' | 'two-hand';
  score: Score;
  synthSeed: number;
}

async function activations(
  p: Piece,
  load: () => Promise<Awaited<ReturnType<typeof loadBasicPitchModelNode>>>,
  render: () => Float32Array = () => synthesizeScore(p.score, { seed: p.synthSeed }),
): Promise<ModelOutput> {
  const file = join(CACHE, `${p.name.replace(/\W+/g, '_')}-${p.synthSeed}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as ModelOutput;
  const out = await runModel(await load(), render());
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, JSON.stringify(out));
  return out;
}

const pct = (x: number) => (x * 100).toFixed(1);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

describe.skipIf(!process.env.TUNE)('audio post-processing grid search (TUNE=1)', () => {
  test('grid search on the dev set, defaults on the held-out fixtures', { timeout: 900_000 }, async () => {
    let model: Awaited<ReturnType<typeof loadBasicPitchModelNode>> | null = null;
    const load = async () => (model ??= await loadBasicPitchModelNode());
    const dev: Piece[] = audioDevSet();
    const heldOut: Piece[] = [
      { name: 'monophonic', kind: 'monophonic', score: monophonicMelody(), synthSeed: 1 },
      { name: 'two-hand', kind: 'two-hand', score: twoHandPiece(), synthSeed: 2 },
    ];
    const outs = new Map<string, ModelOutput>();
    for (const p of [...dev, ...heldOut]) outs.set(p.name, await activations(p, load));

    const decoded = new Map<string, RawNoteEvent[]>();
    const decode = (p: Piece, melodiaTrick: boolean, onsetThreshold: number) => {
      const key = `${p.name}|${melodiaTrick}|${onsetThreshold}`;
      if (!decoded.has(key))
        decoded.set(
          key,
          decodeNotes(outs.get(p.name)!, { ...DEFAULT_DECODE_PARAMS, melodiaTrick, onsetThreshold }),
        );
      return decoded.get(key)!;
    };

    interface Row {
      label: string;
      mono: number;
      two: number;
      perPiece: number[];
    }
    const rows: Row[] = [];
    for (const melodia of [true, false])
      for (const onset of [0.5, 0.6, 0.7])
        for (const reattackOnset of [0, 0.7, 0.8, 0.9])
          for (const ghostMaxOnset of [0, 0.8, 0.85, 0.9])
            for (const ghostAmplitudeRatio of [0.5, 0.6])
              for (const minOnset of [0, 0.4, 0.6]) {
                if (ghostMaxOnset === 0 && ghostAmplitudeRatio !== 0.6) continue;
                const perPiece = dev.map((p) => {
                  const ev = cleanEvents(decode(p, melodia, onset), {
                    // reattack 0 = merging disabled
                    mergeGap: reattackOnset === 0 ? -1 : DEFAULT_POSTPROCESS.mergeGap,
                    reattackOnset,
                    ghostMaxOnset,
                    ghostAmplitudeRatio,
                    minOnset,
                  });
                  return noteF1(p.score.notes, ev, 0.05).f1;
                });
                rows.push({
                  label: `melodia=${melodia} onset=${onset} reattack=${reattackOnset} ghost=${ghostMaxOnset}/${ghostAmplitudeRatio} minOnset=${minOnset}`,
                  mono: mean(perPiece.filter((_, i) => dev[i]!.kind === 'monophonic')),
                  two: mean(perPiece.filter((_, i) => dev[i]!.kind === 'two-hand')),
                  perPiece,
                });
              }
    const fmt = (r: Row) =>
      `mono ${pct(r.mono)} two ${pct(r.two)} | ${r.label} | ${r.perPiece.map((x) => pct(x)).join(' ')}`;
    rows.sort((a, b) => b.mono + b.two - (a.mono + a.two));
    report(
      `[tune] ${rows.length} configs on ${dev.length} dev pieces (${dev.map((p) => p.name).join(', ')})`,
    );
    report('[tune] top 10:');
    for (const r of rows.slice(0, 10)) report(`[tune]   ${fmt(r)}`);

    const d = DEFAULT_POSTPROCESS;
    const shipped = `melodia=${DEFAULT_DECODE_PARAMS.melodiaTrick} onset=${DEFAULT_DECODE_PARAMS.onsetThreshold} reattack=${d.reattackOnset} ghost=${d.ghostMaxOnset}/${d.ghostAmplitudeRatio} minOnset=${d.minOnset}`;
    const base = `melodia=true onset=0.5`;
    report('[tune] ablation around the shipped defaults (Basic Pitch decoder kept at its own defaults):');
    for (const label of [
      shipped,
      `${base} reattack=0 ghost=${d.ghostMaxOnset}/${d.ghostAmplitudeRatio} minOnset=${d.minOnset}`,
      `${base} reattack=${d.reattackOnset} ghost=0/0.6 minOnset=${d.minOnset}`,
      `${base} reattack=${d.reattackOnset} ghost=${d.ghostMaxOnset}/${d.ghostAmplitudeRatio} minOnset=0`,
      `${base} reattack=0 ghost=0/0.6 minOnset=0`,
    ]) {
      const r = rows.find((x) => x.label === label);
      if (r) report(`[tune]   ${fmt(r)}${label === shipped ? '   <- shipped' : ''}`);
    }

    report('[tune] held-out test fixtures with the shipped defaults:');
    for (const p of heldOut) {
      const raw = decode(p, DEFAULT_DECODE_PARAMS.melodiaTrick, DEFAULT_DECODE_PARAMS.onsetThreshold);
      report(
        `[tune]   ${p.name}: raw F1 ${pct(noteF1(p.score.notes, raw, 0.05).f1)} → post-processed ${pct(noteF1(p.score.notes, cleanEvents(raw), 0.05).f1)}`,
      );
    }
  });
});

function asPiece(r: RealisticPiece): Piece {
  return { name: r.name, kind: r.kind, score: r.score, synthSeed: r.seed };
}

describe.skipIf(!process.env.TUNE || process.env.TUNE_SET !== 'realistic')(
  'audio post-processing on the recording-like TUNING set (TUNE=1 TUNE_SET=realistic)',
  () => {
    test(
      'grid ranked on the realistic tuning set; clean dev set alongside',
      { timeout: 3_600_000 },
      async () => {
        let model: Awaited<ReturnType<typeof loadBasicPitchModelNode>> | null = null;
        const load = async () => (model ??= await loadBasicPitchModelNode());
        const tuning = realisticTuningSet();
        const dev: Piece[] = audioDevSet();
        const outs = new Map<string, ModelOutput>();
        for (const r of tuning)
          outs.set(r.name, await activations(asPiece(r), load, () => renderRealistic(r)));
        for (const p of dev) outs.set(p.name, await activations(p, load));

        const decoded = new Map<string, RawNoteEvent[]>();
        const decode = (name: string, melodiaTrick: boolean, onsetThreshold: number) => {
          const key = `${name}|${melodiaTrick}|${onsetThreshold}`;
          if (!decoded.has(key))
            decoded.set(
              key,
              decodeNotes(outs.get(name)!, { ...DEFAULT_DECODE_PARAMS, melodiaTrick, onsetThreshold }),
            );
          return decoded.get(key)!;
        };
        interface Cfg {
          melodia: boolean;
          onset: number;
          reattackOnset: number;
          ghostMaxOnset: number;
          ghostAmplitudeRatio: number;
          ghostOnsetRatio: number;
          minOnset: number;
          minDuration: number;
        }
        const f1Of = (name: string, ref: Score, c: Cfg) =>
          noteF1(
            ref.notes,
            cleanEvents(decode(name, c.melodia, c.onset), {
              mergeGap: c.reattackOnset === 0 ? -1 : DEFAULT_POSTPROCESS.mergeGap,
              reattackOnset: c.reattackOnset,
              ghostMaxOnset: c.ghostMaxOnset,
              ghostAmplitudeRatio: c.ghostAmplitudeRatio,
              ghostOnsetRatio: c.ghostOnsetRatio,
              minOnset: c.minOnset,
              minDuration: c.minDuration,
            }),
            0.05,
          ).f1;
        const label = (c: Cfg) =>
          `melodia=${c.melodia} onset=${c.onset} reattack=${c.reattackOnset} ghost=${c.ghostMaxOnset}/${c.ghostAmplitudeRatio}/${c.ghostOnsetRatio} minOnset=${c.minOnset} minDur=${c.minDuration}`;

        const rows: { cfg: Cfg; tuning: number; byVariant: Record<string, number>; dev: number }[] = [];
        for (const melodia of [true, false])
          for (const onset of [0.4, 0.5, 0.6])
            for (const reattackOnset of [0, 0.7, 0.8, 0.9])
              for (const ghostMaxOnset of [0, 0.85, 0.9, 0.95])
                for (const ghostAmplitudeRatio of [0.6, 0.8])
                  for (const ghostOnsetRatio of [Infinity, 0.8, 0.9, 1.0])
                    for (const minOnset of [0, 0.5, 0.6])
                      for (const minDuration of [0.05, 0.08]) {
                        if (
                          ghostMaxOnset === 0 &&
                          (ghostAmplitudeRatio !== 0.6 || ghostOnsetRatio !== Infinity)
                        )
                          continue;
                        const cfg = {
                          melodia,
                          onset,
                          reattackOnset,
                          ghostMaxOnset,
                          ghostAmplitudeRatio,
                          ghostOnsetRatio,
                          minOnset,
                          minDuration,
                        };
                        const byVariant: Record<string, number[]> = {};
                        for (const r of tuning)
                          (byVariant[r.variant] ??= []).push(f1Of(r.name, r.score, cfg));
                        const variantMeans = Object.fromEntries(
                          Object.entries(byVariant).map(([k, v]) => [k, mean(v)]),
                        );
                        rows.push({
                          cfg,
                          tuning: mean(Object.values(variantMeans)),
                          byVariant: variantMeans,
                          dev: mean(dev.map((p) => f1Of(p.name, p.score, cfg))),
                        });
                      }
        const fmt = (r: (typeof rows)[number]) =>
          `tuning ${pct(r.tuning)} (${Object.entries(r.byVariant)
            .map(([k, v]) => `${k} ${pct(v)}`)
            .join(', ')}) | clean dev ${pct(r.dev)} | ${label(r.cfg)}`;
        rows.sort((a, b) => b.tuning - a.tuning);
        const d = DEFAULT_POSTPROCESS;
        const shippedCfg: Cfg = {
          melodia: DEFAULT_DECODE_PARAMS.melodiaTrick,
          onset: DEFAULT_DECODE_PARAMS.onsetThreshold,
          reattackOnset: d.reattackOnset,
          ghostMaxOnset: d.ghostMaxOnset,
          ghostAmplitudeRatio: d.ghostAmplitudeRatio,
          ghostOnsetRatio: d.ghostOnsetRatio,
          minOnset: d.minOnset,
          minDuration: d.minDuration,
        };
        const shipped = rows.find((r) => label(r.cfg) === label(shippedCfg))!;
        report(
          `[tune-real] ${rows.length} configs on ${tuning.length} tuning renders (${[...new Set(tuning.map((r) => r.name.split('/')[0]))].join(', ')} × room/pedal/soft/all)`,
        );
        report(`[tune-real] shipped: ${fmt(shipped)}`);
        report('[tune-real] top 10 on the tuning set:');
        for (const r of rows.slice(0, 10)) report(`[tune-real]   ${fmt(r)}`);
        // Selection rule (fixed before looking at the evaluation set): best tuning-set mean among
        // configs that are not worse than the shipped defaults on the clean dev set.
        const best = rows.find((r) => r.dev >= shipped.dev)!;
        report(`[tune-real] best on the tuning set without hurting the clean dev set: ${fmt(best)}`);
        report('[tune-real] one-parameter changes from the shipped defaults (tuning set):');
        for (const key of Object.keys(shippedCfg) as (keyof Cfg)[]) {
          for (const r of rows.filter((x) =>
            (Object.keys(shippedCfg) as (keyof Cfg)[]).every((k) => k === key || x.cfg[k] === shippedCfg[k]),
          )) {
            if (r.cfg[key] !== shippedCfg[key])
              report(`[tune-real]   ${key}=${String(r.cfg[key])}: ${fmt(r)}`);
          }
        }

        if (process.env.EVAL === '1') {
          report('[tune-real] EVALUATION set (reporting only), shipped vs best-on-tuning:');
          const evalSet = realisticEvaluationSet();
          for (const r of evalSet)
            outs.set(r.name, await activations(asPiece(r), load, () => renderRealistic(r)));
          for (const [name, cfg] of [
            ['shipped', shippedCfg],
            ['best-on-tuning', best.cfg],
          ] as const) {
            const byVariant: Record<string, number[]> = {};
            for (const r of evalSet) (byVariant[r.variant] ??= []).push(f1Of(r.name, r.score, cfg));
            const means = Object.entries(byVariant).map(([k, v]) => `${k} ${pct(mean(v))}`);
            report(
              `[tune-real]   ${name}: mean ${pct(mean(Object.values(byVariant).map(mean)))} (${means.join(', ')}) | ${label(cfg)}`,
            );
          }
        }
      },
    );
  },
);
