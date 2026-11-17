import { describe, expect, it } from 'vitest';
import { scoreToMusicXml } from '../../src/converters/outputs/musicxml';
import { analyzeKey } from '../../src/core/key';
import { isFreeTiming } from '../../src/core/quantize';
import { createScore, type Note } from '../../src/core/score';
import { autoKey, defaultSheetSettings, KEY_CHOICES, keyValue, parseKey, quantizeOptions, tonicName, withTimeSig } from '../../src/ui/sheetSettings';
import { fMajorOverPedal, performed } from '../fixtures/ballade';
import { minuetInG, pieceToScore } from '../fixtures/music';

/** 8 bars of 6/8 at dotted quarter = 60, played with jitter (a "recording"). */
function sixEightRecording(): Note[] {
  const notes: Note[] = [];
  let seed = 3;
  const j = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.03;
  for (let bar = 0; bar < 8; bar++) {
    const t0 = 0.5 + bar * 2;
    for (const [pos, pitch, dur, vel] of [
      [0, 72, 2, 0.8], [0, 84, 2, 0.8], [2, 72, 1, 0.6], [3, 72, 2, 0.75], [3, 84, 2, 0.75], [5, 72, 1, 0.6],
      [0, 44, 3, 0.8], [1, 63, 1, 0.4], [2, 63, 1, 0.4], [3, 51, 3, 0.7], [4, 63, 1, 0.4], [5, 63, 1, 0.4],
    ] as const) {
      notes.push({ pitch, start: t0 + pos / 3 + j(), duration: dur / 3 - 0.05, velocity: vel, hand: pitch >= 72 ? 'R' : 'L', track: 0 });
    }
  }
  return notes;
}

describe('sheet settings', () => {
  it('prefills free-timing scores with the estimated meter and tempo', () => {
    const score = createScore({ notes: sixEightRecording() });
    expect(isFreeTiming(score)).toBe(true);
    const s = defaultSheetSettings(score);
    expect(s.timeSig).toBe('6/8');
    expect(Math.abs(Number(s.bpmText) - 60)).toBeLessThanOrEqual(3);
    const opts = quantizeOptions(score, true, s);
    expect(opts.legato).toBe(true);
    expect(opts.timeline?.pulseQuarters).toBe(0.5);
    // Quarter-note tempo = dotted quarter × 1.5.
    expect(Math.abs(opts.timeline!.bpm - 90)).toBeLessThan(5);
  });

  it('keeps the notated tempo and meter for notated scores', () => {
    const score = pieceToScore(minuetInG);
    expect(defaultSheetSettings(score)).toMatchObject({ bpmText: String(minuetInG.bpm), timeSig: '3/4' });
    expect(quantizeOptions(score, false, defaultSheetSettings(score))).toEqual({});
  });

  it('a typed tempo re-tracks the pulse at that tempo; a meter change converts the beat unit', () => {
    const score = createScore({ notes: sixEightRecording() });
    const s = defaultSheetSettings(score);
    const slow = quantizeOptions(score, true, { ...s, bpmText: '40' });
    expect(slow.timeline!.bpm).toBeCloseTo(60); // 40 dotted quarters = 60 quarters
    // Following the estimate: switching to 3/4 takes the 3/4 estimate.
    const three = withTimeSig(score, s, '3/4');
    expect(three.timeSig).toBe('3/4');
    expect(Number(three.bpmText)).toBeGreaterThan(60);
    // A typed tempo keeps its quarter-note speed: 40 ♩. = 60 ♩.
    expect(withTimeSig(score, { ...s, bpmText: '40' }, '3/4').bpmText).toBe('60');
  });

  it('names keys with flats and solfège', () => {
    expect(tonicName({ fifths: -4, mode: 'major' })).toBe('A♭');
    expect(tonicName({ fifths: -4, mode: 'minor' })).toBe('F');
    expect(tonicName({ fifths: 6, mode: 'major' }, true)).toBe('Fa♯');
    expect(tonicName({ fifths: -4, mode: 'major' }, true)).toBe('La♭');
  });
});

describe('key over a dominant pedal', () => {
  it('F-major tune of repeated Cs over a C pedal (6/8) → one flat, no sharps', () => {
    const score = { ...performed(fMajorOverPedal), key: undefined }; // a transcription has no key
    // Profile correlation alone prefers C major (tonic C, dominant G); with the pedal chord
    // left out, the B♭s, the F and A and the bass resolving to F decide.
    const a = analyzeKey(score.notes);
    expect(a.pedal).toBe(0);
    expect(a.key).toEqual({ fifths: -1, mode: 'major' });
    expect(a.margin).toBeGreaterThan(0.2);
    const free = isFreeTiming(score);
    expect(free).toBe(true);
    const s = defaultSheetSettings(score, free);
    expect(s.timeSig).toBe('6/8');
    const xml = scoreToMusicXml(score, quantizeOptions(score, free, s));
    expect(xml).toContain('<fifths>-1</fifths>');
    expect(xml).not.toContain('<alter>1</alter>');
    expect(xml).not.toContain('<accidental>'); // B♭ comes from the key signature
  });

  it('a chosen key overrides the estimate: signature and spelling follow', () => {
    const score = { ...performed(fMajorOverPedal), key: undefined };
    const free = isFreeTiming(score);
    const s = { ...defaultSheetSettings(score, free), key: keyValue({ fifths: 0, mode: 'major' }) };
    const xml = scoreToMusicXml(score, quantizeOptions(score, free, s));
    expect(xml).toContain('<fifths>0</fifths>');
    // B♭ is now outside the key: spelled B♭ with a printed flat, never A♯.
    expect(xml).toContain('<alter>-1</alter>');
    expect(xml).toContain('<accidental>flat</accidental>');
    expect(xml).not.toContain('<alter>1</alter>');
  });
});

describe('key setting', () => {
  it('auto is the file key, else the estimate', () => {
    expect(defaultSheetSettings(pieceToScore(minuetInG)).key).toBe('auto');
    expect(autoKey(pieceToScore(minuetInG))).toEqual({ key: { fifths: 1, mode: 'major' }, fromFile: true });
    const free = { ...performed(fMajorOverPedal), key: undefined }; // a transcription has no key
    expect(autoKey(free)).toEqual({ key: { fifths: -1, mode: 'major' }, fromFile: false });
  });

  it('offers the 24 keys and round-trips their values', () => {
    expect(KEY_CHOICES).toHaveLength(24);
    expect(new Set(KEY_CHOICES.map(keyValue)).size).toBe(24);
    for (const k of KEY_CHOICES) expect(parseKey(keyValue(k))).toEqual(k);
    expect(parseKey('auto')).toBeUndefined();
    expect(parseKey('9:major')).toBeUndefined();
  });

  it('applies a chosen key to notated scores too (and nothing else)', () => {
    const score = pieceToScore(minuetInG);
    expect(quantizeOptions(score, false, { ...defaultSheetSettings(score), key: '-3:major' })).toEqual({ key: { fifths: -3, mode: 'major' } });
    const xml = scoreToMusicXml(score, quantizeOptions(score, false, { ...defaultSheetSettings(score), key: '-3:major' }));
    expect(xml).toContain('<fifths>-3</fifths>');
  });
});
