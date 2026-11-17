import { describe, expect, it } from 'vitest';
import { scoreToMusicXml } from '../../src/converters/outputs/musicxml';
import { spell } from '../../src/converters/outputs/musicxml/scoreToMusicXml';
import { decompose, noteValues } from '../../src/converters/outputs/musicxml/layout';
import { createScore, type KeySignature, type Note } from '../../src/core/score';

const name = (pitch: number, key: KeySignature, dir = 0) => {
  const s = spell(pitch, key, dir);
  return `${s.step}${s.alter < 0 ? 'b'.repeat(-s.alter) : '#'.repeat(s.alter)}${s.octave}`;
};
const AB: KeySignature = { fifths: -4, mode: 'major' };
const C: KeySignature = { fifths: 0, mode: 'major' };

describe('spelling by key', () => {
  it('spells A♭ major with flats and never with sharps', () => {
    expect([56, 58, 60, 61, 63, 65, 67].map((p) => name(p, AB))).toEqual(['Ab3', 'Bb3', 'C4', 'Db4', 'Eb4', 'F4', 'G4']);
    // Chromatic notes: E♮, A♮, D♮, G♭ — and no sharp for any of the 12 pitch classes.
    expect([64, 69, 62, 66].map((p) => name(p, AB))).toEqual(['E4', 'A4', 'D4', 'Gb4']);
    for (let p = 48; p < 60; p++) expect(spell(p, AB).alter).toBeLessThanOrEqual(0);
  });

  it('spells sharp keys with sharps and C major conventionally', () => {
    const E: KeySignature = { fifths: 4, mode: 'major' };
    expect([68, 61, 63, 66].map((p) => name(p, E))).toEqual(['G#4', 'C#4', 'D#4', 'F#4']);
    expect([61, 63, 66, 70].map((p) => name(p, C))).toEqual(['C#4', 'Eb4', 'F#4', 'Bb4']);
    // Minor keys raise the 7th: G♯ in A minor.
    expect(name(68, { fifths: 0, mode: 'minor' })).toBe('G#4');
  });

  it('follows the line when two spellings are close: E♮→F, F♭→E♭, G♯→A, A♭→G', () => {
    expect(name(64, AB, +1)).toBe('E4');
    expect(name(64, AB, -1)).toBe('Fb4');
    expect(name(68, C, +1)).toBe('G#4');
    expect(name(68, C, -1)).toBe('Ab4');
    // A clear default does not flip: F♯ in C major even when it falls to F.
    expect(name(66, C, -1)).toBe('F#4');
  });

  it('keeps octave numbers right for C♭ and B♯', () => {
    expect(name(71, { fifths: -7, mode: 'major' })).toBe('Cb5');
    expect(name(60, { fifths: 7, mode: 'major' })).toBe('B#3');
  });

  it('writes flats, the key signature and a dotted-quarter metronome mark in 6/8', () => {
    const notes: Note[] = [56, 60, 63, 61, 64, 65].map((pitch, i) => ({ pitch, start: i * 0.25, duration: 0.25, velocity: 0.8, hand: 'R', track: 0 }));
    const xml = scoreToMusicXml(createScore({ notes, key: AB, timeSignature: { numerator: 6, denominator: 8 }, tempos: [{ time: 0, bpm: 90 }] }));
    expect(xml).toContain('<fifths>-4</fifths>');
    expect(xml).not.toContain('<alter>1</alter>');
    expect(xml).toContain('<accidental>natural</accidental>'); // E♮ before F
    expect(xml).toContain('<beat-unit-dot/><per-minute>60</per-minute>');
    expect(xml).toContain('<sound tempo="90"/>');
  });
});

describe('compound meter note values', () => {
  it('writes ♪♩ inside a 6/8 beat without a tie', () => {
    const v = noteValues(4);
    const six = (o: number, d: number) => decompose(o, d, { values: v, beat: 6, measureTicks: 12, compound: true }).map((x) => `${x.type}${x.dots ? '.' : ''}`);
    expect(six(2, 4)).toEqual(['quarter']); // second eighth of the beat, a quarter to the beat's end
    expect(six(6, 4)).toEqual(['quarter']); // ♩ on beat 2
    expect(six(2, 6)).toEqual(['quarter', 'eighth']); // crosses the beat: tied
  });
});
