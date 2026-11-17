import { describe, expect, it } from 'vitest';
import { estimateKey, isFreeTiming, quantize, tapTempo } from '../../src/core/quantize';
import { createScore, type Note } from '../../src/core/score';
import { assignVoices, buildChords, decompose, noteValues, voicePieces } from '../../src/converters/outputs/musicxml/layout';
import { cMajorScale, minuetInG, pieceToScore, p } from '../fixtures/music';

function n(pitch: number, start: number, duration: number, hand: 'L' | 'R' | null = 'R'): Note {
  return { pitch, start, duration, velocity: 0.7, hand, track: 0 };
}

/** Deterministic pseudo-random jitter in [-amp, amp]. */
function jitter(i: number, amp: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2 * amp;
}

describe('quantize', () => {
  it('maps exact notes to grid ticks (120 BPM, 1/16 grid)', () => {
    const q = quantize(createScore({ notes: [n(60, 0, 0.5), n(62, 0.5, 0.25), n(64, 0.75, 0.25), n(65, 1, 1)] }));
    expect(q.divisions).toBe(4);
    expect(q.measureTicks).toBe(16);
    expect(q.notes.map((x) => [x.pitch, x.start, x.duration])).toEqual([
      [60, 0, 4],
      [62, 4, 2],
      [64, 6, 2],
      [65, 8, 8],
    ]);
  });

  it('snaps ±25 ms jitter back to the written rhythm (100 BPM)', () => {
    const beat = 0.6;
    const written = [0, 1, 1.5, 2, 2.75, 3, 4, 4.5, 5, 6, 7, 7.25, 7.5, 7.75]; // beats
    const notes = written.map((b, i) => n(60 + (i % 12), b * beat + jitter(i, 0.025), 0.12 + Math.abs(jitter(i + 99, 0.02))));
    const q = quantize(createScore({ notes, tempos: [{ time: 0, bpm: 100 }] }));
    expect(q.notes.length).toBe(written.length);
    expect(q.notes.map((x) => x.start)).toEqual(written.map((b) => b * 4));
  });

  it('straightens light swing (58/42 eighths) to even eighths', () => {
    const notes: Note[] = [];
    for (let beat = 0; beat < 8; beat++) {
      notes.push(n(67, beat * 0.5, 0.25));
      notes.push(n(69, beat * 0.5 + 0.58 * 0.5, 0.18));
    }
    const q = quantize(createScore({ notes }));
    expect(q.notes.map((x) => x.start)).toEqual(Array.from({ length: 16 }, (_, i) => i * 2));
  });

  it('keeps the tones of a rolled chord together even across a grid boundary', () => {
    // 120 BPM: a 16th is 125 ms. Alone, 50 ms → tick 0 and 70/90 ms → tick 1; together they share one tick.
    const q = quantize(createScore({ notes: [n(60, 0.05, 1), n(64, 0.07, 1), n(67, 0.09, 1), n(48, 0.06, 1, 'L')] }));
    expect(new Set(q.notes.map((x) => x.start)).size).toBe(1);
    expect(q.notes.length).toBe(4);
  });

  it('drops micro-notes, reports them, and never invents notes', () => {
    const notes = [n(60, 0, 0.5), n(61, 0.5, 0.01), n(62, 1, 0.5), n(63, 1.2, 0.005), n(64, 2, 0.06)];
    const q = quantize(createScore({ notes }));
    expect(q.dropped).toBe(2);
    expect(q.notes.map((x) => x.pitch)).toEqual([60, 62, 64]);
    // A short but real note keeps at least one grid step.
    expect(q.notes.find((x) => x.pitch === 64)!.duration).toBe(1);
  });

  it('never produces more notes than it was given (dense random input)', () => {
    const notes = Array.from({ length: 300 }, (_, i) => n(40 + ((i * 7) % 40), Math.abs(jitter(i, 30)), 0.01 + Math.abs(jitter(i + 7, 0.5)), i % 3 ? 'R' : null));
    const q = quantize(createScore({ notes }));
    expect(q.notes.length + q.dropped).toBeLessThanOrEqual(notes.length);
    for (const x of q.notes) {
      expect(Number.isInteger(x.start) && Number.isInteger(x.duration)).toBe(true);
      expect(x.duration).toBeGreaterThanOrEqual(1);
    }
  });

  it('merges same-pitch duplicates and cuts overlapping repeats', () => {
    const q = quantize(createScore({ notes: [n(60, 0, 1), n(60, 0.01, 0.5), n(60, 0.5, 0.5)] }));
    expect(q.notes.map((x) => [x.start, x.duration])).toEqual([
      [0, 4],
      [4, 4],
    ]);
  });

  it('uses a user BPM and aligns the first note to beat 1', () => {
    const notes = [0, 1, 2, 3].map((b) => n(60 + b, 1.3 + b * 0.75, 0.7)); // 80 BPM, 1.3 s lead-in
    const q = quantize(createScore({ notes }), { bpm: 80, timeSignature: { numerator: 3, denominator: 4 } });
    expect(q.notes.map((x) => x.start)).toEqual([0, 4, 8, 12]);
    expect(q.measureTicks).toBe(12);
    expect(q.tempos).toEqual([{ tick: 0, bpm: 80 }]);
  });

  it('follows tempo changes in the Score', () => {
    // 120 BPM for 2 s (4 beats), then 60 BPM: a note at 3 s is beat 5.
    const q = quantize(createScore({ notes: [n(60, 0, 0.5), n(62, 3, 1)], tempos: [{ time: 0, bpm: 120 }, { time: 2, bpm: 60 }] }));
    expect(q.notes.map((x) => [x.start, x.duration])).toEqual([
      [0, 4],
      [20, 4],
    ]);
    expect(q.tempos).toEqual([
      { tick: 0, bpm: 120 },
      { tick: 16, bpm: 60 },
    ]);
  });

  it('assigns staves by hand, and by the C4 split when the hand is unknown', () => {
    const q = quantize(createScore({ notes: [n(72, 0, 1, 'L'), n(48, 0, 1, 'R'), n(59, 1, 1, null), n(60, 1, 1, null)] }));
    expect(q.notes.map((x) => `${x.pitch}${x.hand}`)).toEqual(['48R', '72L', '59L', '60R']);
  });
});

describe('isFreeTiming', () => {
  it('is false for notated fixtures and true for jittered free timing', () => {
    expect(isFreeTiming(pieceToScore(minuetInG))).toBe(false);
    const notes = pieceToScore(minuetInG).notes.map((x, i) => ({ ...x, start: x.start * 1.13 + 0.4 + jitter(i, 0.04) }));
    expect(isFreeTiming(createScore({ notes }))).toBe(true);
  });
});

describe('tapTempo', () => {
  it('computes BPM from steady taps', () => {
    expect(tapTempo([0, 500, 1000, 1500, 2000])).toBe(120);
    expect(tapTempo([100, 850, 1600])).toBe(80);
  });
  it('ignores an outlier and restarts after a pause', () => {
    expect(tapTempo([0, 500, 1000, 1700, 2200, 2700])).toBeCloseTo(120, 0);
    expect(tapTempo([0, 300, 600, 5000, 5600, 6200])).toBe(100);
  });
  it('needs at least two taps', () => {
    expect(tapTempo([])).toBeNull();
    expect(tapTempo([42])).toBeNull();
  });
});

describe('estimateKey', () => {
  const scale = (names: string[]) => names.map((name, i) => ({ pitch: p(name), duration: i === 0 ? 2 : 1 }));
  it.each([
    ['G major scale', scale(['G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F#5', 'G5', 'D4', 'B3', 'G3']), { fifths: 1, mode: 'major' }],
    ['F major scale', scale(['F4', 'G4', 'A4', 'Bb4', 'C5', 'D5', 'E5', 'F5', 'C4', 'A3', 'F3']), { fifths: -1, mode: 'major' }],
    ['A harmonic minor', scale(['A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G#4', 'A4', 'E4', 'C4', 'A3', 'A2']), { fifths: 0, mode: 'minor' }],
    ['E-flat major triads', scale(['Eb4', 'G4', 'Bb4', 'Eb5', 'Ab4', 'C5', 'Bb3', 'D4', 'F4', 'Eb3']), { fifths: -3, mode: 'major' }],
  ])('%s', (_name, notes, key) => {
    expect(estimateKey(notes)).toEqual(key);
  });
  it('finds G major for the Minuet and C major for the scale', () => {
    expect(estimateKey(pieceToScore(minuetInG).notes)).toEqual({ fifths: 1, mode: 'major' });
    expect(estimateKey(pieceToScore(cMajorScale).notes)).toEqual({ fifths: 0, mode: 'major' });
    expect(estimateKey([])).toEqual({ fifths: 0, mode: 'major' });
  });
});

describe('notation layout', () => {
  const values = noteValues(4);

  it('decomposes durations into beat-aligned note values', () => {
    const ctx = { values, beat: 4, measureTicks: 16, compound: false };
    const names = (offset: number, dur: number, rest = false) =>
      decompose(offset, dur, { ...ctx, rest }).map((v) => `${v.type}${v.dots ? '.' : ''}`);
    expect(names(0, 12)).toEqual(['half.']);
    expect(names(0, 5)).toEqual(['quarter', '16th']);
    expect(names(2, 4)).toEqual(['eighth', 'eighth']); // a quarter starting off the beat is split
    expect(names(1, 3)).toEqual(['16th', 'eighth']);
    expect(names(0, 16)).toEqual(['whole']);
    expect(names(4, 8)).toEqual(['quarter', 'quarter']); // no half note on beat 2 of 4/4
    expect(names(0, 12, true)).toEqual(['half', 'quarter']); // no dotted rests in simple meter
    // 3/4: a half note on beat 2 is idiomatic.
    expect(decompose(4, 8, { values, beat: 4, measureTicks: 12, compound: false }).map((v) => v.type)).toEqual(['half']);
    // 6/8: a full bar is a dotted half; from beat 2, a dotted quarter.
    const six = (o: number, d: number) =>
      decompose(o, d, { values, beat: 6, measureTicks: 12, compound: true }).map((v) => `${v.type}${v.dots ? '.' : ''}`);
    expect(six(0, 12)).toEqual(['half.']);
    expect(six(6, 6)).toEqual(['quarter.']);
  });

  it('puts held notes and moving notes in different voices', () => {
    const notes = [
      { pitch: 72, start: 0, duration: 16, hand: 'R' as const, velocity: 1 },
      ...[0, 4, 8, 12].map((s) => ({ pitch: 64 + s / 4, start: s, duration: 4, hand: 'R' as const, velocity: 1 })),
    ];
    const voices = assignVoices(buildChords(notes));
    expect(voices.length).toBe(2);
    expect(voices[0]!.map((c) => c.pitches)).toEqual([[72]]);
    expect(voices[1]!.length).toBe(4);
  });

  it('ties a note across the barline and fills gaps with rests', () => {
    const pieces = voicePieces([{ start: 12, duration: 8, pitches: [60] }], {
      totalTicks: 32,
      measureTicks: 16,
      divisions: 4,
      timeSignature: { numerator: 4, denominator: 4 },
      primary: true,
    });
    const desc = pieces.map((x) => `${x.kind}@${x.start}+${x.duration}${x.tieStop ? '<' : ''}${x.tieStart ? '>' : ''}${x.measureRest ? 'M' : ''}`);
    expect(desc).toEqual(['rest@0+8', 'rest@8+4', 'chord@12+4>', 'chord@16+4<', 'rest@20+4', 'rest@24+8']);
  });
});
