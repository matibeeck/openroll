import { describe, expect, it } from 'vitest';
import { createScore, type Note } from '../../src/core/score';
import { PracticeTracker } from '../../src/core/practice';
import { Transport } from '../../src/core/transport';

const n = (pitch: number, start: number, hand: 'L' | 'R' = 'R'): Note => ({
  pitch, start, duration: 0.4, velocity: 0.8, hand, track: 0,
});
// C4, E4, then a C major chord + left-hand C3 at 1.0 s, then G4.
const score = createScore({
  notes: [n(60, 0), n(64, 0.5), n(60, 1), n(64, 1), n(67, 1), n(48, 1, 'L'), n(67, 1.5)],
});

/** Simulated MIDI events: [time, pitch]. */
function play(tracker: PracticeTracker, events: [number, number][], until: number) {
  let i = 0;
  for (let t = 0; t <= until; t = Math.round((t + 0.01) * 1000) / 1000) {
    while (i < events.length && events[i]![0] <= t) tracker.noteOn(events[i++]![1], t);
    tracker.update(t);
  }
}

describe('scoring (no wait mode)', () => {
  it('counts hits, misses and wrong notes', () => {
    const tr = new PracticeTracker(score, { hands: 'R' });
    // Play C4 on time, E4 120 ms late (hit), skip the chord's G4, play a wrong D4, play G4 early by 0.1 s.
    play(tr, [[0.02, 60], [0.62, 64], [1.01, 60], [1.03, 64], [1.2, 62], [1.4, 67]], 3);
    expect(tr.stats).toEqual({ hits: 5, misses: 1, wrong: 1, accuracy: 83.3 });
  });

  it('presses outside the tolerance are wrong and the note is missed', () => {
    const tr = new PracticeTracker(score, { hands: 'R' });
    play(tr, [[0.3, 60]], 3);
    expect(tr.stats.hits).toBe(0);
    expect(tr.stats.misses).toBe(6);
    expect(tr.stats.wrong).toBe(1);
  });

  it('hands selector filters expected notes', () => {
    expect(new PracticeTracker(score, { hands: 'L' }).groupCount).toBe(1);
    expect(new PracticeTracker(score, { hands: 'both' }).groupCount).toBe(4);
  });
});

describe('wait mode', () => {
  it('holds the transport until the right notes are played', () => {
    let clock = 0;
    const transport = new Transport(() => clock);
    const tr = new PracticeTracker(score, { hands: 'both', waitMode: true });
    transport.play();
    const step = (dt: number) => {
      clock += dt;
      const hold = tr.update(transport.time);
      if (hold !== null) transport.hold(hold);
      return transport.time;
    };
    expect(step(0.5)).toBe(0); // waiting at C4
    expect(tr.noteOn(62, transport.time)).toBe('wrong'); // wrong key does not release
    expect(step(0.5)).toBe(0);
    expect(tr.noteOn(60, transport.time)).toBe('hit');
    expect(step(0.3)).toBeCloseTo(0.3);
    expect(step(0.5)).toBe(0.5); // waiting at E4
    tr.noteOn(64, 0.5);
    expect(step(0.6)).toBe(1); // waiting at the chord
    for (const p of [60, 64, 67]) tr.noteOn(p, 1);
    expect(step(0.1)).toBe(1); // still waiting: left-hand C3 missing
    expect(tr.upcoming?.pitches).toEqual([48]);
    tr.noteOn(48, 1);
    expect(step(0.2)).toBeCloseTo(1.2);
    expect(tr.stats).toEqual({ hits: 6, misses: 0, wrong: 1, accuracy: 100 });
  });

  it('reset restarts scoring from the seek point', () => {
    const tr = new PracticeTracker(score, { hands: 'R', waitMode: true });
    tr.update(0);
    tr.noteOn(60, 0);
    tr.reset(1);
    expect(tr.stats.hits).toBe(0);
    expect(tr.update(1)).toBe(1);
    expect(tr.upcoming?.pitches.sort()).toEqual([60, 64, 67]);
  });
});

describe('transport', () => {
  it('speed, seek, pause and A-B loop', () => {
    let clock = 0;
    const tp = new Transport(() => clock, 10);
    tp.setSpeed(0.5);
    tp.play();
    clock = 2;
    expect(tp.time).toBeCloseTo(1);
    tp.setSpeed(1.5);
    clock = 3;
    expect(tp.time).toBeCloseTo(2.5);
    tp.pause();
    clock = 10;
    expect(tp.time).toBeCloseTo(2.5);
    tp.setSpeed(1);
    tp.setLoop(2, 4);
    tp.seek(3.5);
    tp.play();
    clock = 11;
    expect(tp.time).toBeCloseTo(2.5);
    expect(tp.speed).toBe(1);
    tp.setSpeed(9);
    expect(tp.speed).toBe(1.5);
  });
});
