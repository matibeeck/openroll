/**
 * Grid search that chose DEFAULT_POSTPROCESS (M4). Skipped unless TUNE=1; run it with
 * `npm run tune:audio` (scripts/tune-audio-postprocess.mjs).
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
import { cleanEvents, DEFAULT_POSTPROCESS, type RawNoteEvent } from '../../src/converters/inputs/audio/postprocess';
import { audioDevSet } from '../fixtures/audio-devset';
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

async function activations(p: Piece, load: () => Promise<Awaited<ReturnType<typeof loadBasicPitchModelNode>>>): Promise<ModelOutput> {
  const file = join(CACHE, `${p.name}-${p.synthSeed}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as ModelOutput;
  const out = await runModel(await load(), synthesizeScore(p.score, { seed: p.synthSeed }));
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
      if (!decoded.has(key)) decoded.set(key, decodeNotes(outs.get(p.name)!, { ...DEFAULT_DECODE_PARAMS, melodiaTrick, onsetThreshold }));
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
    const fmt = (r: Row) => `mono ${pct(r.mono)} two ${pct(r.two)} | ${r.label} | ${r.perPiece.map((x) => pct(x)).join(' ')}`;
    rows.sort((a, b) => b.mono + b.two - (a.mono + a.two));
    report(`[tune] ${rows.length} configs on ${dev.length} dev pieces (${dev.map((p) => p.name).join(', ')})`);
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
