import { describe, expect, it } from 'vitest';
import { snapTempoMap } from '../../src/converters/outputs/midi/scoreToMidi';
import { beatsToSeconds, normalizeTempos, secondsToBeats } from '../../src/core/tempo';

describe('tempo map', () => {
  const map = normalizeTempos([
    { time: 4, bpm: 60 },
    { time: 0, bpm: 120 },
    { time: 6, bpm: 240 },
  ]);

  it('normalizes: sorted, entry at 0, later duplicate wins, invalid dropped', () => {
    expect(map).toEqual([
      { time: 0, bpm: 120 },
      { time: 4, bpm: 60 },
      { time: 6, bpm: 240 },
    ]);
    expect(normalizeTempos([])).toEqual([{ time: 0, bpm: 120 }]);
    expect(normalizeTempos([{ time: 1, bpm: 90 }])).toEqual([{ time: 0, bpm: 90 }, { time: 1, bpm: 90 }]);
    expect(normalizeTempos([{ time: 0, bpm: 100 }, { time: 0, bpm: 80 }, { time: 2, bpm: -5 }])).toEqual([{ time: 0, bpm: 80 }]);
  });

  it('converts seconds ↔ beats across tempo changes', () => {
    expect(secondsToBeats(map, 2)).toBeCloseTo(4); // 120 BPM
    expect(secondsToBeats(map, 4)).toBeCloseTo(8);
    expect(secondsToBeats(map, 5)).toBeCloseTo(9); // 60 BPM
    expect(secondsToBeats(map, 7)).toBeCloseTo(14); // 240 BPM after 6 s (10 beats)
    for (const s of [0, 0.3, 3.99, 4, 5.5, 6, 12.25]) expect(beatsToSeconds(map, secondsToBeats(map, s))).toBeCloseTo(s, 9);
  });

  it('snaps to integer µs per quarter at integer ticks', () => {
    const { ticks, seconds } = snapTempoMap([{ time: 0, bpm: 90 }, { time: 1.0001, bpm: 133 }], 960);
    expect(ticks).toEqual([
      { tick: 0, usPerQuarter: 666667 },
      { tick: 1440, usPerQuarter: 451128 },
    ]);
    expect(seconds[1]!.time).toBeCloseTo(1.0000005, 6);
  });
});
