/**
 * Recording → readable sheet music, end to end: a performed fixture of the Ballade No. 3 theme
 * (A♭ major, 6/8, RH repeated C octaves; tests/fixtures/ballade.ts) → piano-like synth →
 * Basic Pitch (tfjs CPU) + the real post-processing → the Sheet tab's own settings (tempo/meter
 * estimate, legato quantization) → MusicXML, loaded in Verovio.
 *
 * Asserts what made the first real recording unreadable: meter (6/8, not 4/4), key (−4 flats,
 * no sharps, naturals only where the music has them) and clutter (≤ 1 rest per staff per bar,
 * see docs/DECISIONS.md). Prints the tempo estimate, hand agreement and note F1.
 * Audio is SYNTHETIC; real recordings are checked by scripts/real-check (not in CI).
 */
import { beforeAll, describe, expect, test } from 'vitest';
import type { GraphModel } from '@tensorflow/tfjs';
import { decodeNotes, runModel } from '../../src/converters/inputs/audio/basic-pitch-run';
import { postprocess } from '../../src/converters/inputs/audio/postprocess';
import { scoreToMusicXml } from '../../src/converters/outputs/musicxml';
import { isFreeTiming } from '../../src/core/quantize';
import type { Score } from '../../src/core/score';
import { withVerovio } from '../../src/core/verovio';
import { defaultSheetSettings, quantizeOptions, sheetEstimate } from '../../src/ui/sheetSettings';
import { BALLADE_SPELLING, performedBallade } from '../fixtures/ballade';
import { loadBasicPitchModelNode } from './basic-pitch-node';
import { formatMetrics, noteF1, report } from './metrics';
import { synthesizeScore } from './synth';

/** Average rests per staff per bar must stay at or below this (DECISIONS 2026-11-17). */
const MAX_RESTS_PER_STAFF_BAR = 1.0;
const ONSET_TOLERANCE = 0.05;

let model: GraphModel;
beforeAll(async () => {
  model = await loadBasicPitchModelNode();
});

interface XmlNote {
  rest: boolean;
  step?: string;
  alter: number;
  octave?: number;
  accidental?: string;
}

function xmlNotes(xml: string): XmlNote[] {
  return [...xml.matchAll(/<note>(.*?)<\/note>/gs)].map(([, body]) => ({
    rest: body!.includes('<rest'),
    step: /<step>(\w)<\/step>/.exec(body!)?.[1],
    alter: Number(/<alter>(-?\d)<\/alter>/.exec(body!)?.[1] ?? 0),
    octave: Number(/<octave>(\d)<\/octave>/.exec(body!)?.[1]),
    accidental: /<accidental>([\w-]+)<\/accidental>/.exec(body!)?.[1],
  }));
}

function sheetStats(xml: string) {
  const notes = xmlNotes(xml);
  const measures = (xml.match(/<measure\b/g) ?? []).length;
  const rests = notes.filter((n) => n.rest).length;
  return {
    time: `${/<beats>(\d+)/.exec(xml)?.[1]}/${/<beat-type>(\d+)/.exec(xml)?.[1]}`,
    fifths: Number(/<fifths>(-?\d+)/.exec(xml)?.[1]),
    measures,
    rests,
    restsPerStaffBar: rests / Math.max(1, 2 * measures),
    ties: (xml.match(/<tie type="start"/g) ?? []).length,
    sharps: notes.filter((n) => n.alter > 0).length,
  };
}

function fmt(s: ReturnType<typeof sheetStats>): string {
  return `${s.time}, fifths ${s.fifths}, ${s.measures} bars, ${s.rests} rests (${s.restsPerStaffBar.toFixed(2)} per staff-bar), ${s.ties} ties, ${s.sharps} sharps`;
}

async function loadsInVerovio(xml: string): Promise<void> {
  await withVerovio((tk) => {
    tk.setOptions({ pageWidth: 2100, adjustPageHeight: true });
    const ok = tk.loadData(xml);
    const log = tk.getLog();
    expect(Boolean(ok), log).toBe(true);
    expect(log, 'Verovio log').not.toMatch(/error|invalid|mismatch|could not/i);
    expect(tk.renderToSVG(1)).toContain('<svg');
  });
}

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

describe('recording → readable sheet (Ballade No. 3 theme, synthetic audio)', () => {
  test('6/8, A♭ major with flats, few rests', async () => {
    const reference = performedBallade();
    const audio = synthesizeScore(reference, { seed: 3 });
    const score = postprocess(decodeNotes(await runModel(model, audio)), { title: 'Ballade theme' });

    const f1 = noteF1(reference.notes, score.notes, ONSET_TOLERANCE);
    report(`[sheet-recording] ${formatMetrics('transcription', f1)}`);
    const hands = handAgreement(reference, score);
    report(`[sheet-recording] hand agreement on matched notes: ${(hands * 100).toFixed(1)}%`);

    const free = isFreeTiming(score);
    expect(free).toBe(true);
    const settings = defaultSheetSettings(score, free);
    const est = sheetEstimate(score)!;
    // Played at dotted quarter = 60 with ±5 % rubato.
    report(
      `[sheet-recording] estimate: ${est.timeSignature.numerator}/${est.timeSignature.denominator}, dotted quarter = ${est.beatBpm.toFixed(1)} (played 60), confidence ${est.confidence.toFixed(1)}`,
    );

    // Before: what the Sheet tab did for recordings (120 BPM, 4/4, raw durations, 1/16 grid).
    const before = sheetStats(scoreToMusicXml(score, { bpm: 120, timeSignature: { numerator: 4, denominator: 4 } }));
    report(`[sheet-recording] before: ${fmt(before)}`);

    const xml = scoreToMusicXml(score, quantizeOptions(score, free, settings));
    const after = sheetStats(xml);
    report(`[sheet-recording] after:  ${fmt(after)}`);
    const simple = scoreToMusicXml(score, quantizeOptions(score, free, { ...settings, simplify: true }));
    const simpleStats = sheetStats(simple);
    report(`[sheet-recording] simplified: ${fmt(simpleStats)}`);

    expect(settings.timeSig).toBe('6/8');
    expect(Math.abs(est.beatBpm / 60 - 1)).toBeLessThan(0.1);
    expect(after.time).toBe('6/8');
    expect(after.fifths).toBe(-4);
    expect(after.sharps).toBe(0);
    // Every pitch class of the fixture is spelled as in the fixture (A♭ B♭ C D♭ E♭ F G, E♮).
    for (const n of xmlNotes(xml).filter((x) => !x.rest)) {
      const pc = ((({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[n.step!]! + n.alter) % 12 + 12) % 12;
      if (BALLADE_SPELLING[pc]) expect(`${n.step}${n.alter}`).toBe(BALLADE_SPELLING[pc]);
    }
    // Naturals only where the fixture has them (E♮ in bar 6).
    for (const n of xmlNotes(xml).filter((x) => x.accidental === 'natural')) expect(n.step).toBe('E');
    expect(after.restsPerStaffBar).toBeLessThanOrEqual(MAX_RESTS_PER_STAFF_BAR);
    expect(simpleStats.restsPerStaffBar).toBeLessThanOrEqual(after.restsPerStaffBar);
    expect(f1.f1).toBeGreaterThanOrEqual(0.7);
    expect(hands).toBeGreaterThanOrEqual(0.9);

    await loadsInVerovio(xml);
    await loadsInVerovio(simple);
  });
});
