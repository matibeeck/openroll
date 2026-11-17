/**
 * Practice logic: wait mode and scoring against expected notes. Pure and deterministic;
 * the UI feeds it the transport time and note-on events (Web MIDI, computer keyboard, on-screen keys).
 */
import type { Score } from './score';

export interface PracticeOptions {
  hands: 'both' | 'L' | 'R';
  waitMode: boolean;
  /** Seconds around a note's onset in which a key press counts as a hit. */
  tolerance: number;
  /** Notes whose onsets are closer than this form one chord (one wait step). */
  chordWindow: number;
}

export const DEFAULT_PRACTICE: PracticeOptions = {
  hands: 'both',
  waitMode: false,
  tolerance: 0.15,
  chordWindow: 0.03,
};

export interface PracticeStats {
  hits: number;
  misses: number;
  /** Key presses that matched no expected note. */
  wrong: number;
  /** hits / (hits + misses), 0–100; 100 when nothing was judged yet. */
  accuracy: number;
}

interface Group {
  time: number;
  pitches: number[];
  remaining: Set<number>;
  resolved: boolean;
}

export class PracticeTracker {
  private groups: Group[] = [];
  private next = 0;
  private hits = 0;
  private misses = 0;
  private wrong = 0;
  readonly options: PracticeOptions;

  constructor(score: Score, options: Partial<PracticeOptions> = {}) {
    this.options = { ...DEFAULT_PRACTICE, ...options };
    const { hands, chordWindow } = this.options;
    const notes = score.notes.filter((n) => hands === 'both' || n.hand === hands || n.hand === null);
    for (const n of notes) {
      const last = this.groups[this.groups.length - 1];
      if (last && n.start - last.time <= chordWindow) {
        if (!last.remaining.has(n.pitch)) {
          last.pitches.push(n.pitch);
          last.remaining.add(n.pitch);
        }
      } else {
        this.groups.push({
          time: n.start,
          pitches: [n.pitch],
          remaining: new Set([n.pitch]),
          resolved: false,
        });
      }
    }
  }

  /** Number of expected chords/notes groups. */
  get groupCount(): number {
    return this.groups.length;
  }

  /** Expected pitches of the group the player should play next (for highlighting). */
  get upcoming(): { time: number; pitches: number[] } | null {
    const g = this.groups[this.next];
    return g ? { time: g.time, pitches: [...g.remaining] } : null;
  }

  /**
   * Advance to time t. Returns the time the transport must hold at (wait mode) or null.
   * Outside wait mode, groups whose window has passed are scored as misses.
   */
  update(t: number): number | null {
    const { waitMode, tolerance } = this.options;
    while (this.next < this.groups.length) {
      const g = this.groups[this.next]!;
      if (g.resolved) {
        this.next++;
        continue;
      }
      if (waitMode) return t >= g.time ? g.time : null;
      if (t > g.time + tolerance) {
        this.misses += g.remaining.size;
        g.resolved = true;
        this.next++;
        continue;
      }
      return null;
    }
    return null;
  }

  noteOn(pitch: number, t: number): 'hit' | 'wrong' {
    const { waitMode, tolerance } = this.options;
    for (let i = this.next; i < this.groups.length; i++) {
      const g = this.groups[i]!;
      if (g.time - tolerance > t) break;
      if (g.resolved) continue;
      const inWindow = waitMode ? t >= g.time - tolerance : Math.abs(t - g.time) <= tolerance;
      if (inWindow && g.remaining.has(pitch)) {
        g.remaining.delete(pitch);
        this.hits++;
        if (g.remaining.size === 0) g.resolved = true;
        return 'hit';
      }
      // In wait mode only the current group can be played.
      if (waitMode) break;
    }
    this.wrong++;
    return 'wrong';
  }

  /** Restart scoring from time t (seek or loop wrap). Groups before t are ignored. */
  reset(t = 0): void {
    this.hits = this.misses = this.wrong = 0;
    for (const g of this.groups) {
      g.remaining = new Set(g.pitches);
      g.resolved = g.time < t - this.options.tolerance;
    }
    this.next = 0;
  }

  get stats(): PracticeStats {
    const judged = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      wrong: this.wrong,
      accuracy: judged === 0 ? 100 : Math.round((this.hits / judged) * 1000) / 10,
    };
  }
}
