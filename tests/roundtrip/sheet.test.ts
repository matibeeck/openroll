import { describe, expect, it } from 'vitest';
import { musicXmlToScore } from '../../src/converters/inputs/musicxml/musicxmlToScore';
import { scoreToMusicXml } from '../../src/converters/outputs/musicxml';
import { renderSheetWith } from '../../src/converters/outputs/sheet/render';
import { createScore, type Note, type Score } from '../../src/core/score';
import { withVerovio } from '../../src/core/verovio';
import { allPieces, minuetInG, pieceToMusicXml, pieceToScore } from '../fixtures/music';
import { noteF1 } from './metrics';

const MS = 0.001;

/** Load MusicXML in Verovio; fail on load errors or warnings that mean broken markup. */
async function loadsInVerovio(xml: string): Promise<{ pages: number; svg: string; log: string }> {
  return withVerovio((tk) => {
    tk.setOptions({ pageWidth: 2100, adjustPageHeight: true });
    const ok = tk.loadData(xml);
    const log = tk.getLog();
    expect(Boolean(ok), log).toBe(true); // Verovio returns 1, not true
    expect(log, 'Verovio log').not.toMatch(/error|invalid|mismatch|could not/i);
    const pages = tk.getPageCount();
    return { pages, svg: tk.renderToSVG(1), log };
  });
}

function compare(expected: Score, got: Score, label: string): void {
  const m = noteF1(expected.notes, got.notes, MS);
  let maxOnset = 0;
  let maxDur = 0;
  expected.notes.forEach((e, i) => {
    const g = got.notes[i];
    if (!g) return;
    maxOnset = Math.max(maxOnset, Math.abs(g.start - e.start));
    maxDur = Math.max(maxDur, Math.abs(g.duration - e.duration));
  });
  console.log(
    `[sheet round-trip] ${label}: notes ${expected.notes.length}→${got.notes.length}, F1 ${m.f1.toFixed(3)} (onset ±1 ms), max onset error ${(maxOnset * 1000).toFixed(3)} ms, max duration error ${(maxDur * 1000).toFixed(3)} ms`,
  );
  expect(got.notes.map((n) => n.pitch)).toEqual(expected.notes.map((n) => n.pitch));
  expect(maxOnset).toBeLessThanOrEqual(MS);
  expect(maxDur).toBeLessThanOrEqual(MS);
  expect(got.notes.map((n) => n.hand)).toEqual(expected.notes.map((n) => n.hand));
  expect(m.f1).toBe(1);
}

describe('Score → MusicXML: valid for Verovio', () => {
  it.each(allPieces.map((p) => [p.title, p] as const))('"%s" loads and renders', async (title, piece) => {
    const xml = scoreToMusicXml(pieceToScore(piece));
    expect(xml).toContain('<score-partwise version="4.0">');
    expect(xml).toContain('<staves>2</staves>');
    const { pages, svg } = await loadsInVerovio(xml);
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(svg).toContain('<svg');
    expect(svg).toContain(title.split(' (')[0]!);
  });

  it('writes ties across barlines, rests, chords, backup and forward', async () => {
    const notes: Note[] = [
      // RH: C5 held from beat 4 of bar 1 into bar 2 (tie), with a moving inner voice (forward).
      { pitch: 72, start: 1.5, duration: 1.0, velocity: 0.8, hand: 'R', track: 0 },
      { pitch: 64, start: 0, duration: 2.0, velocity: 0.8, hand: 'R', track: 0 },
      { pitch: 67, start: 2.0, duration: 0.25, velocity: 0.8, hand: 'R', track: 0 },
      { pitch: 65, start: 2.25, duration: 0.25, velocity: 0.8, hand: 'R', track: 0 },
      // LH: chord on beat 1 of bar 2 only (bar 1 = whole-bar rest).
      { pitch: 48, start: 2, duration: 1, velocity: 0.8, hand: 'L', track: 0 },
      { pitch: 55, start: 2, duration: 1, velocity: 0.8, hand: 'L', track: 0 },
      // Accidentals: F#4 then F4 in the same bar needs a natural.
      { pitch: 66, start: 3, duration: 0.25, velocity: 0.8, hand: 'R', track: 0 },
      { pitch: 65, start: 3.25, duration: 0.25, velocity: 0.8, hand: 'R', track: 0 },
    ];
    const score = createScore({ title: 'Notation features', notes, key: { fifths: 0, mode: 'major' } });
    const xml = scoreToMusicXml(score);
    for (const tag of ['<tie type="start"/>', '<tie type="stop"/>', '<rest measure="yes"/>', '<chord/>', '<backup>', '<forward>', '<accidental>natural</accidental>', '<accidental>sharp</accidental>']) {
      expect(xml, tag).toContain(tag);
    }
    await loadsInVerovio(xml);
    const back = await musicXmlToScore(xml);
    compare(score, back, 'notation features');
  });

  it('writes a key signature, tempo changes and an empty score', async () => {
    const notes: Note[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ pitch: [63, 65, 67, 68, 70, 72, 74, 75][i]!, start: i < 4 ? i * 0.5 : 2 + (i - 4) * 1, duration: i < 4 ? 0.5 : 1, velocity: 0.7, hand: 'R', track: 0 }));
    const score = createScore({ notes, tempos: [{ time: 0, bpm: 120 }, { time: 2, bpm: 60 }], title: 'Eb & tempo' });
    const xml = scoreToMusicXml(score);
    expect(xml).toContain('<fifths>-3</fifths>'); // estimated from pitches: E-flat major
    expect(xml).toContain('Eb &amp; tempo');
    expect((xml.match(/<sound tempo=/g) ?? []).length).toBe(2);
    await loadsInVerovio(xml);
    const back = await musicXmlToScore(xml);
    compare(score, back, 'tempo change');
    expect(back.tempos.map((t) => Math.round(t.bpm))).toEqual([120, 60]);

    const empty = scoreToMusicXml(createScore({ notes: [], title: 'Empty' }));
    expect((await loadsInVerovio(empty)).pages).toBe(1);
  });
});

describe('MusicXML → Score → MusicXML → Score', () => {
  it.each(allPieces.map((p) => [p.title, p] as const))('"%s" keeps pitches, onsets, durations and hands', async (title, piece) => {
    const fixture = pieceToScore(piece);
    const first = await musicXmlToScore(pieceToMusicXml(piece));
    const xml = scoreToMusicXml(first);
    const second = await musicXmlToScore(xml);
    compare(fixture, second, title);
    expect(second.title).toBe(title);
    expect(second.key).toEqual(fixture.key);
    expect(second.timeSignature).toEqual(fixture.timeSignature);
    // Idempotent: writing again gives the same document.
    expect(scoreToMusicXml(second)).toBe(xml);
  });
});

describe('free timing → sheet', () => {
  it('quantizes a jittered, tempo-less performance back onto the written rhythm', async () => {
    const fixture = pieceToScore(minuetInG);
    // A "recording": 1.25 s lead-in, played at 100 BPM instead of 120, ±20 ms timing jitter.
    const stretch = 120 / 100;
    const played = fixture.notes.map((n, i) => ({
      ...n,
      hand: null,
      start: 1.25 + n.start * stretch + Math.sin(i * 7.31) * 0.02,
      duration: n.duration * stretch * 0.9,
    }));
    const score = createScore({ title: 'Played minuet', notes: played });
    const xml = scoreToMusicXml(score, { bpm: 100, timeSignature: { numerator: 3, denominator: 4 }, key: { fifths: 1, mode: 'major' } });
    await loadsInVerovio(xml);
    const back = await musicXmlToScore(xml);
    // Back at the score's 100 BPM: compare against the fixture stretched to 100 BPM.
    const expected = fixture.notes.map((n) => ({ pitch: n.pitch, start: n.start * stretch }));
    const m = noteF1(expected, back.notes, 0.05);
    console.log(`[sheet free timing] Minuet played at 100 BPM ±20 ms: F1 ${m.f1.toFixed(3)} (onset ±50 ms), notes ${expected.length}→${back.notes.length}`);
    expect(m.f1).toBe(1);
  });
});

describe('sheet rendering (worker code path, run in Node)', () => {
  it('renders every page to SVG at the requested width', async () => {
    const xml = scoreToMusicXml(pieceToScore(minuetInG));
    const result = await withVerovio((tk) => renderSheetWith(tk, xml, { width: 600, scale: 60 }));
    expect(result.pageCount).toBe(result.pages.length);
    expect(result.pageCount).toBeGreaterThanOrEqual(2); // narrow and zoomed in → several pages
    for (const svg of result.pages) expect(svg).toMatch(/^<svg[^>]*width="600px"/);
    const wide = await withVerovio((tk) => renderSheetWith(tk, xml, { width: 1200, scale: 30 }));
    expect(wide.pageCount).toBeLessThan(result.pageCount);
  });

  it('throws on input Verovio cannot read', async () => {
    await expect(withVerovio((tk) => renderSheetWith(tk, 'not xml at all', { width: 800 }))).rejects.toThrow();
  });
});
