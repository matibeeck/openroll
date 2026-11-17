/**
 * Progress of audio / performance-video conversions (src/converters/inputs/audio/progress.ts):
 * monotonic, every stage labelled, and each stage's share of the bar close to its share of the
 * time. Stage times below are the ones measured in Chrome on an Apple M5 Pro (docs/DECISIONS.md).
 */
import { describe, expect, test } from 'vitest';
import { modelWindows } from '../../src/converters/inputs/audio/mono';
import { AudioProgress, DECODE_END, planSegments } from '../../src/converters/inputs/audio/progress';
import { report } from './metrics';

/** Simulates a conversion with given stage durations (ms) and returns (time, fraction, label) samples. */
function simulate(o: { decodeMs: number; modelMs: number; windows: number; windowMs: number; finishMs: number; warm: boolean }) {
  const samples: { t: number; f: number; label?: string }[] = [];
  let t = 0;
  const p = new AudioProgress((f, label) => samples.push({ t, f, label }));
  p.reading();
  t += o.decodeMs / 2;
  p.decoding();
  t += o.decodeMs / 2;
  p.plan({ windows: o.windows, windowMs: o.warm ? o.windowMs : null, modelPending: !o.warm });
  if (!o.warm) {
    for (const [v, share] of [[0, 0], [0.05, 0.02], [0.15, 0.03], [0.9, 0.85], [1, 0.1]] as const) {
      t += o.modelMs * share;
      p.worker('loading-model', v);
    }
  }
  for (let i = 0; i <= o.windows; i++) {
    p.worker('transcribing', i / o.windows);
    if (i < o.windows) t += o.windowMs;
  }
  p.worker('finishing', 0);
  t += o.finishMs;
  p.done();
  return { samples, total: t };
}

describe('audio conversion progress', () => {
  test('window count matches Basic Pitch framing', () => {
    expect(modelWindows(0)).toBe(1);
    expect(modelWindows(22050)).toBe(1);
    expect(modelWindows(24.15 * 22050)).toBe(15);
    expect(modelWindows(60 * 22050)).toBe(37);
  });

  for (const [name, o] of [
    ['the real recording-like 24 s video, warm', { decodeMs: 60, modelMs: 0, windows: 15, windowMs: 32, finishMs: 10, warm: true }],
    ['24 s video, cold model', { decodeMs: 60, modelMs: 380, windows: 15, windowMs: 32, finishMs: 10, warm: false }],
    ['5 min video, warm', { decodeMs: 650, modelMs: 0, windows: 177, windowMs: 32, finishMs: 90, warm: true }],
  ] as const) {
    test(`${name}: monotonic, labelled, roughly linear in time`, () => {
      const { samples, total } = simulate(o);
      for (let i = 1; i < samples.length; i++) expect(samples[i]!.f).toBeGreaterThanOrEqual(samples[i - 1]!.f);
      expect(samples.every((s) => s.label)).toBe(true);
      expect(samples.at(-1)!.f).toBe(1);
      // Largest gap between the fraction and the elapsed share of the time.
      const worst = Math.max(...samples.map((s) => Math.abs(s.f - s.t / total)));
      report(`[audio-progress] ${name}: max |fraction − time share| = ${(worst * 100).toFixed(1)} pts over ${samples.length} updates`);
      expect(worst).toBeLessThan(0.12);
    });
  }

  test('model loading gets a share only while the model is cold', () => {
    expect(planSegments({ windows: 15, windowMs: 32, modelPending: false }).modelEnd).toBe(DECODE_END);
    expect(planSegments({ windows: 15, windowMs: null, modelPending: true }).modelEnd).toBeGreaterThan(DECODE_END + 0.3);
  });
});
