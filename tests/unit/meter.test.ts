import { describe, expect, it } from 'vitest';
import { beatQuarters, estimateMeter, meterShape, onsetEvents, pulseIndex } from '../../src/core/meter';
import type { Note } from '../../src/core/score';

/** One bar of a pattern: [pulse position, pitch, duration in pulses, velocity]. */
type Ev = [number, number, number, number?];

/**
 * Build notes from a one-bar pattern repeated `bars` times. `pulse` is seconds per pulse
 * (eighth); `rubato` scales the local tempo by 1 ± rubato (slow sine over 4 bars); `jitter`
 * shifts each onset by a deterministic ±jitter seconds; `lead` delays the whole piece.
 */
function build(bar: Ev[], pulsesPerBar: number, bars: number, pulse: number, o: { rubato?: number; jitter?: number; lead?: number; pickup?: Ev[] } = {}): Note[] {
  const rubato = o.rubato ?? 0;
  const jitter = o.jitter ?? 0;
  const lead = o.lead ?? 0.4;
  // Pulse k → seconds, integrating a slowly varying tempo.
  const total = (bars + 1) * pulsesPerBar + 4;
  const times: number[] = [lead];
  for (let k = 0; k < total; k++) times.push(times[k]! + pulse * (1 + rubato * Math.sin((2 * Math.PI * k) / (4 * pulsesPerBar))));
  const at = (x: number) => {
    const k = Math.floor(x);
    return times[k]! + (x - k) * (times[k + 1]! - times[k]!);
  };
  const notes: Note[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const offset = o.pickup ? pulsesPerBar : 0;
  const push = (pos: number, pitch: number, dur: number, vel = 0.7) => {
    const start = at(pos) + jitter * rand();
    notes.push({ pitch, start, duration: at(pos + dur) - at(pos) - 0.02, velocity: vel, hand: null, track: 0 });
  };
  for (const [pos, pitch, dur, vel] of o.pickup ?? []) push(pos, pitch, dur, vel);
  for (let b = 0; b < bars; b++) for (const [pos, pitch, dur, vel] of bar) push(offset + b * pulsesPerBar + pos, pitch, dur, vel);
  return notes.sort((a, b) => a.start - b.start);
}

// 6/8, Ballade-like: RH repeated C octave in the siciliano rhythm (♩ ♪ ♩ ♪), LH bass + chords.
const SIX_EIGHT: Ev[] = [
  [0, 72, 2], [0, 84, 2], [2, 72, 1], [2, 84, 1], [3, 72, 2], [3, 84, 2], [5, 72, 1], [5, 84, 1],
  [0, 44, 3, 0.8], [1, 60, 1, 0.5], [1, 63, 1, 0.5], [2, 60, 1, 0.5], [2, 63, 1, 0.5],
  [3, 51, 3, 0.7], [4, 60, 1, 0.5], [4, 63, 1, 0.5], [5, 60, 1, 0.5], [5, 63, 1, 0.5],
];
// 3/4 waltz: bass on beat 1, chords on beats 2 and 3, RH eighths.
const THREE_FOUR: Ev[] = [
  [0, 43, 2, 0.8], [2, 59, 2, 0.5], [2, 62, 2, 0.5], [4, 59, 2, 0.5], [4, 62, 2, 0.5],
  [0, 79, 2, 0.8], [2, 74, 1], [3, 76, 1], [4, 78, 1], [5, 79, 1],
];
// 4/4: bass on beats 1 and 3, RH eighths with longer notes on the beats.
const FOUR_FOUR: Ev[] = [
  [0, 36, 4, 0.8], [4, 43, 4, 0.7],
  [0, 72, 2, 0.8], [2, 76, 1], [3, 79, 1], [4, 77, 2, 0.75], [6, 74, 1], [7, 71, 1],
];
// 9/8: bass on each bar, RH flowing eighths, a longer melody note on each beat.
const NINE_EIGHT: Ev[] = [
  [0, 41, 9, 0.85], [3, 48, 6, 0.55], [6, 53, 3, 0.55],
  [0, 77, 2, 0.8], [2, 72, 1], [3, 76, 2, 0.7], [5, 72, 1], [6, 74, 2, 0.7], [8, 72, 1],
];
// 12/8: one bass note per bar, triplet-eighth arpeggios, melody notes on beats 1, 2 and 4
// (a bar-long phrase: beat 3 only continues the arpeggio, so the bar does not split in two).
const TWELVE_EIGHT: Ev[] = [
  [0, 36, 12, 0.9], [0, 72, 3, 0.85], [1, 64, 1, 0.5], [2, 67, 1, 0.5], [3, 74, 3, 0.65], [4, 65, 1, 0.5], [5, 69, 1, 0.5],
  [6, 64, 1, 0.5], [7, 67, 1, 0.5], [8, 72, 1, 0.5], [9, 74, 3, 0.65], [10, 65, 1, 0.5], [11, 71, 1, 0.5],
];

function ts(s: string) {
  const [numerator, denominator] = s.split('/').map(Number) as [number, number];
  return { numerator, denominator };
}

describe('meterShape', () => {
  it('groups compound meters in threes and simple meters in twos', () => {
    expect(meterShape(ts('6/8'))).toEqual({ group: 3, beats: 2, pulseQuarters: 0.5 });
    expect(meterShape(ts('12/8'))).toEqual({ group: 3, beats: 4, pulseQuarters: 0.5 });
    expect(meterShape(ts('3/4'))).toEqual({ group: 2, beats: 3, pulseQuarters: 0.5 });
    expect(meterShape(ts('3/8'))).toEqual({ group: 2, beats: 3, pulseQuarters: 0.25 });
    expect(beatQuarters(ts('6/8'))).toBe(1.5);
    expect(beatQuarters(ts('2/2'))).toBe(2);
  });
});

describe('onsetEvents', () => {
  it('groups chord tones and accents long bass notes', () => {
    const notes = build(SIX_EIGHT, 6, 2, 0.3);
    const ev = onsetEvents(notes);
    expect(ev.length).toBe(12); // every eighth of 2 bars
    // The downbeat (bass + long RH octave) is the most accented event of the bar.
    const bar = ev.slice(0, 6).map((e) => e.accent);
    expect(bar.indexOf(Math.max(...bar))).toBe(0);
  });
});

describe('pulseIndex', () => {
  it('interpolates inside and extrapolates outside', () => {
    const t = [1, 2, 4];
    expect(pulseIndex(t, 1.5)).toBeCloseTo(0.5);
    expect(pulseIndex(t, 3)).toBeCloseTo(1.5);
    expect(pulseIndex(t, 0)).toBeCloseTo(-1);
    expect(pulseIndex(t, 6)).toBeCloseTo(3);
  });
});

describe('estimateMeter', () => {
  const cases: [string, Ev[], number, string, number][] = [
    // name, pattern, pulses per bar, expected meter, seconds per eighth
    ['6/8 siciliano (Ballade-like)', SIX_EIGHT, 6, '6/8', 0.3],
    ['3/4 waltz', THREE_FOUR, 6, '3/4', 0.25],
    ['4/4 with eighths', FOUR_FOUR, 8, '4/4', 0.3],
    ['9/8 flowing eighths', NINE_EIGHT, 9, '9/8', 0.22],
    ['12/8 arpeggios', TWELVE_EIGHT, 12, '12/8', 0.2],
  ];

  it.each(cases)('%s → meter, tempo and downbeat', (_name, bar, ppb, meter, pulse) => {
    for (const variant of [{}, { jitter: 0.015 }, { rubato: 0.08, jitter: 0.01 }]) {
      const notes = build(bar, ppb, 8, pulse, variant);
      const est = estimateMeter(notes)!;
      const label = `${_name} ${JSON.stringify(variant)}`;
      console.log(`[meter] ${label}: ${est.timeSignature.numerator}/${est.timeSignature.denominator}, ♩=${est.bpm.toFixed(1)} (true ${(30 / pulse).toFixed(1)}), confidence ${est.confidence.toFixed(1)}`);
      expect(`${est.timeSignature.numerator}/${est.timeSignature.denominator}`, label).toBe(meter);
      // Quarter-note tempo within 6 % of the truth (mean tempo under rubato).
      expect(Math.abs(est.bpm / (30 / pulse) - 1), label).toBeLessThan(0.06);
      // The first pulse is the first downbeat (the first note).
      expect(Math.abs(est.pulses[0]! - notes[0]!.start), label).toBeLessThan(0.05);
      expect(est.pulsesPerBar).toBe(ppb);
    }
  });

  it('tells 6/8 from 3/4 when both play six even eighths per bar', () => {
    // Same onsets every eighth; only accents (bass, long notes) differ.
    const six: Ev[] = [[0, 45, 3, 0.85], [3, 52, 3, 0.75], ...[0, 1, 2, 3, 4, 5].map((k): Ev => [k, 72 + (k % 3), 1, k % 3 === 0 ? 0.8 : 0.5])];
    const three: Ev[] = [[0, 45, 2, 0.85], [2, 52, 2, 0.6], [4, 52, 2, 0.6], ...[0, 1, 2, 3, 4, 5].map((k): Ev => [k, 72 + (k % 2), 1, k % 2 === 0 ? 0.8 : 0.5])];
    expect(estimateMeter(build(six, 6, 8, 0.28))!.timeSignature).toEqual(ts('6/8'));
    expect(estimateMeter(build(three, 6, 8, 0.28))!.timeSignature).toEqual(ts('3/4'));
  });

  it('finds the downbeat after a pickup', () => {
    // Two-eighth anacrusis before the first full 6/8 bar.
    const notes = build(SIX_EIGHT, 6, 8, 0.3, { pickup: [[4, 72, 1], [5, 74, 1]] });
    const est = estimateMeter(notes)!;
    expect(est.timeSignature).toEqual(ts('6/8'));
    // Pulses start a whole bar before the first downbeat, so the pickup sits at pulses 4 and 5.
    expect(pulseIndex(est.pulses, notes[0]!.start)).toBeCloseTo(4, 0);
    const downbeat = notes.find((n) => n.pitch === 44)!.start;
    expect(pulseIndex(est.pulses, downbeat)).toBeCloseTo(6, 0);
  });

  it('honours a user meter and tempo', () => {
    const notes = build(SIX_EIGHT, 6, 8, 0.3);
    const asThree = estimateMeter(notes, { timeSignature: ts('3/4') })!;
    expect(asThree.timeSignature).toEqual(ts('3/4'));
    expect(asThree.pulsesPerBar).toBe(6);
    // User tempo: dotted quarter = 40 → pulse 0.5 s, i.e. slower than played: more pulses.
    const slow = estimateMeter(notes, { timeSignature: ts('6/8'), beatBpm: 40 })!;
    expect(slow.beatBpm).toBeGreaterThan(36);
    expect(slow.beatBpm).toBeLessThan(44);
  });

  it('returns null for too few notes and is cached per notes array', () => {
    expect(estimateMeter([])).toBeNull();
    const notes = build(FOUR_FOUR, 8, 4, 0.3);
    expect(estimateMeter(notes)).toBe(estimateMeter(notes));
  });
});
