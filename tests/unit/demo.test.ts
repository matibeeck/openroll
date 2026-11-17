import { describe, expect, it } from 'vitest';
import { demoScore } from '../../src/core/demo';

describe('example piece', () => {
  it('both hands play to the end: 16 bars of 4/4 at 100 BPM', () => {
    const score = demoScore();
    const end = (hand: 'L' | 'R') =>
      Math.max(...score.notes.filter((n) => n.hand === hand).map((n) => n.start + n.duration / 0.95));
    expect(end('R')).toBeCloseTo(16 * 4 * 0.6, 1);
    expect(end('L')).toBeCloseTo(16 * 4 * 0.6, 0);
    expect(score.notes.every((n) => n.hand === (n.pitch >= 55 ? 'R' : 'L'))).toBe(true);
  });
});
