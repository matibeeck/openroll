import { describe, expect, it } from 'vitest';
import {
  MusicXmlParseError,
  musicXmlToScore,
  parseStaffLayout,
  titleFromMei,
} from '../../src/converters/inputs/musicxml/musicxmlToScore';
import type { Score } from '../../src/core/score';
import { allPieces, chordProgression, minuetInG, musicXmlToMxl, pieceToMusicXml, pieceToScore } from '../fixtures/music';
import { noteF1 } from './metrics';

const MS = 0.001;

/** Pitch/onset sequence must match exactly (onsets within 1 ms); hands per staff. */
function expectMatchesFixture(expected: Score, got: Score, label: string): void {
  const m = noteF1(expected.notes, got.notes, MS);
  let maxOnset = 0;
  expected.notes.forEach((e, i) => {
    const g = got.notes[i];
    if (g) maxOnset = Math.max(maxOnset, Math.abs(g.start - e.start));
  });
  console.log(
    `[musicxml → score] ${label}: notes ${expected.notes.length}→${got.notes.length}, F1 ${m.f1.toFixed(3)} (onset ±1 ms), max onset error ${(maxOnset * 1000).toFixed(3)} ms`,
  );
  expect(got.notes.map((n) => n.pitch)).toEqual(expected.notes.map((n) => n.pitch));
  expect(maxOnset).toBeLessThanOrEqual(MS);
  expect(m.f1).toBe(1);
  expect(got.notes.map((n) => n.hand)).toEqual(expected.notes.map((n) => n.hand));
  // Durations are the notated ones (the tick Verovio shaves off is restored).
  got.notes.forEach((g, i) => {
    expect(Math.abs(g.duration - expected.notes[i]!.duration)).toBeLessThanOrEqual(MS);
  });
}

describe('MusicXML → Score (via Verovio)', () => {
  it.each(allPieces.map((p) => [p.title, p] as const))('"%s" matches the fixture pitch/onset sequence', async (title, piece) => {
    const expected = pieceToScore(piece);
    const got = await musicXmlToScore(pieceToMusicXml(piece), 'fallback');
    expectMatchesFixture(expected, got, title);
    expect(got.title).toBe(title);
    expect(got.timeSignature).toEqual(expected.timeSignature);
    expect(got.key).toEqual(expected.key);
    expect(got.tempos[0]!.bpm).toBeCloseTo(piece.bpm, 3);
  });

  it('reads compressed MusicXML (.mxl)', async () => {
    const expected = pieceToScore(minuetInG);
    const got = await musicXmlToScore(musicXmlToMxl(pieceToMusicXml(minuetInG)));
    expectMatchesFixture(expected, got, 'Minuet in G (.mxl)');
  });

  it('reads MusicXML given as bytes, with a UTF-8 BOM', async () => {
    const xml = new TextEncoder().encode('﻿' + pieceToMusicXml(chordProgression));
    const got = await musicXmlToScore(xml);
    expectMatchesFixture(pieceToScore(chordProgression), got, 'Chord progression (bytes + BOM)');
  });

  it('merges a tie across the barline into one note', async () => {
    const got = await musicXmlToScore(pieceToMusicXml(chordProgression));
    const lowC = got.notes.filter((n) => n.pitch === 48);
    // C3 whole notes in bars 1, 4 and 5; bars 4–5 are tied → two notes, the second 2 bars long.
    expect(lowC.length).toBe(2);
    const secPerBar = (4 * 60) / chordProgression.bpm;
    expect(lowC[1]!.start).toBeCloseTo(3 * secPerBar, 3);
    expect(lowC[1]!.duration).toBeCloseTo(2 * secPerBar, 3);
  });

  it('maps staff 1/2 of the piano part to right/left hand tracks', async () => {
    const got = await musicXmlToScore(pieceToMusicXml(minuetInG));
    expect(got.tracks).toEqual([
      { name: 'Piano - Right hand', hand: 'R' },
      { name: 'Piano - Left hand', hand: 'L' },
    ]);
    // The left hand climbs to D4 (above the C4 split) and still stays left.
    expect(got.notes.filter((n) => n.pitch === 62).every((n) => n.hand === 'L')).toBe(true);
  });

  it('uses the given title when the file has none', async () => {
    const xml = pieceToMusicXml(minuetInG).replace(/<work>.*?<\/work>/, '');
    const got = await musicXmlToScore(xml, 'my-upload');
    expect(got.title).toBe('my-upload');
  });

  it('rejects text that is not MusicXML', async () => {
    await expect(musicXmlToScore('<html><body>nope</body></html>')).rejects.toThrow(MusicXmlParseError);
  });
});

describe('MEI helpers', () => {
  const mei = `<mei><meiHead><fileDesc><titleStmt><title>A &amp; B</title></titleStmt></fileDesc></meiHead>
  <music><body><mdiv><score><scoreDef><staffGrp>
    <staffDef n="1"><label>Flute</label></staffDef>
    <staffGrp xml:id="P2"><label>Piano</label><staffDef n="2"/><staffDef n="3"></staffDef></staffGrp>
    <staffGrp xml:id="P3"><label>Organ</label><staffDef n="4"/><staffDef n="5"/><staffDef n="6"/></staffGrp>
  </staffGrp></scoreDef></score></mdiv></body></music></mei>`;

  it('parses staves, labels and two-staff hand pairs', () => {
    expect(parseStaffLayout(mei)).toEqual([
      { n: 1, label: 'Flute', hand: undefined },
      { n: 2, label: 'Piano', hand: 'R' },
      { n: 3, label: 'Piano', hand: 'L' },
      { n: 4, label: 'Organ', hand: undefined },
      { n: 5, label: 'Organ', hand: undefined },
      { n: 6, label: 'Organ', hand: undefined },
    ]);
  });

  it('reads and unescapes the title', () => {
    expect(titleFromMei(mei)).toBe('A & B');
  });
});
