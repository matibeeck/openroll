/**
 * Pure post-processing of raw transcription events into a Score.
 * No DOM, no workers, no tfjs: Node tests import this directly.
 *
 * Steps, in order:
 *  1. sanitize (finite times, piano range, integer pitch)
 *  2. merge fragments: a same-pitch event that starts inside or just after a note WITHOUT a
 *     clear onset of its own is the same note re-detected, not a re-strike
 *  3. drop harmonic ghosts: a weak-onset, quieter event sitting an octave/twelfth/two octaves
 *     above a sounding note is that note's overtone
 *  4. drop events with no onset evidence at all
 *  5. minimum note length
 *  6. velocity from amplitude
 *  7. hand assignment (src/core/hands)
 */
import { assignHands } from '../../../core/hands';
import { createScore, MAX_PITCH, MIN_PITCH, type Note, type Score } from '../../../core/score';

/** A note as it comes out of the recognizer, before cleanup. Times in seconds. */
export interface RawNoteEvent {
  start: number;
  duration: number;
  /** MIDI pitch. */
  pitch: number;
  /** Mean model activation over the note (0–1). */
  amplitude: number;
  /** Peak onset activation at the note start (0–1), when the recognizer provides it. */
  onsetStrength?: number;
}

export interface PostprocessOptions {
  /** Notes shorter than this (after merging) are dropped. Seconds. */
  minDuration: number;
  /** A same-pitch event starting at most this long after the previous one ends may be a fragment. Seconds. */
  mergeGap: number;
  /** ...and it is merged only if its onset activation is below this (a real re-strike has a strong onset). */
  reattackOnset: number;
  /** Ghost check applies only to events whose onset is below this. */
  ghostMaxOnset: number;
  /** ...and whose amplitude is below this fraction of the lower note's amplitude. */
  ghostAmplitudeRatio: number;
  /** Events with an onset activation below this are dropped (0 disables). */
  minOnset: number;
  /** Velocity range the amplitudes are mapped into (0–1). */
  minVelocity: number;
  maxVelocity: number;
  /** Hand split pitch passed to assignHands. */
  splitPitch: number;
  title: string;
}

export const DEFAULT_POSTPROCESS: PostprocessOptions = {
  minDuration: 0.05,
  mergeGap: 0.05,
  reattackOnset: 0.8,
  ghostMaxOnset: 0.85,
  ghostAmplitudeRatio: 0.6,
  minOnset: 0.6,
  minVelocity: 0.25,
  maxVelocity: 1.0,
  splitPitch: 60,
  title: 'Transcription',
};

/** Semitone distances of the strongest overtones above a fundamental (2nd, 3rd, 4th partial). */
const OVERTONE_INTERVALS = [12, 19, 24];

const end = (e: RawNoteEvent) => e.start + e.duration;

/**
 * Same-pitch fragments become one note: an event that starts within `maxGap` after (or while)
 * the previous same-pitch note sounds is merged into it unless it has its own strong onset.
 * Without onset information, falls back to merging only when the fragment is not louder.
 */
export function mergeFragments(events: RawNoteEvent[], maxGap: number, reattackOnset: number): RawNoteEvent[] {
  const byPitch = new Map<number, RawNoteEvent[]>();
  for (const e of events) {
    const list = byPitch.get(e.pitch) ?? [];
    list.push({ ...e });
    byPitch.set(e.pitch, list);
  }
  const out: RawNoteEvent[] = [];
  for (const list of byPitch.values()) {
    list.sort((a, b) => a.start - b.start);
    let cur = list[0]!;
    for (let i = 1; i < list.length; i++) {
      const next = list[i]!;
      const gap = next.start - end(cur);
      const reattack =
        next.onsetStrength !== undefined ? next.onsetStrength >= reattackOnset : next.amplitude > cur.amplitude;
      if (gap <= maxGap && !reattack) {
        const newEnd = Math.max(end(cur), end(next));
        const total = cur.duration + next.duration;
        cur = {
          start: cur.start,
          duration: newEnd - cur.start,
          pitch: cur.pitch,
          amplitude: (cur.amplitude * cur.duration + next.amplitude * next.duration) / total,
          onsetStrength: cur.onsetStrength,
        };
      } else {
        out.push(cur);
        cur = next;
      }
    }
    out.push(cur);
  }
  return out;
}

/**
 * Drops overtone ghosts: an event with a weak onset whose pitch is 12, 19 or 24 semitones above
 * a louder note that is sounding when it starts. Events without onset information are kept.
 */
export function dropHarmonicGhosts(events: RawNoteEvent[], maxOnset: number, amplitudeRatio: number): RawNoteEvent[] {
  return events.filter((e) => {
    if (e.onsetStrength === undefined || e.onsetStrength >= maxOnset) return true;
    const isGhost = events.some(
      (m) =>
        m !== e &&
        OVERTONE_INTERVALS.includes(e.pitch - m.pitch) &&
        m.start <= e.start + 0.05 &&
        end(m) >= e.start &&
        e.amplitude < m.amplitude * amplitudeRatio,
    );
    return !isGhost;
  });
}

/**
 * Maps model amplitude to velocity. Amplitudes are normalized to the loudest note in the piece
 * (recordings vary in level), then square-root compressed into [minVelocity, maxVelocity].
 */
export function amplitudesToVelocities(amplitudes: number[], minVelocity: number, maxVelocity: number): number[] {
  const max = amplitudes.reduce((m, a) => Math.max(m, a), 0);
  if (max <= 0) return amplitudes.map(() => (minVelocity + maxVelocity) / 2);
  return amplitudes.map((a) => {
    const v = minVelocity + (maxVelocity - minVelocity) * Math.sqrt(Math.max(0, a) / max);
    return Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
  });
}

/** Steps 1–5: raw events → cleaned events (no Score yet). */
export function cleanEvents(events: RawNoteEvent[], opts: Partial<PostprocessOptions> = {}): RawNoteEvent[] {
  const o = { ...DEFAULT_POSTPROCESS, ...opts };
  const valid = events
    .filter((e) => Number.isFinite(e.start) && Number.isFinite(e.duration) && e.duration > 0)
    .map((e) => ({ ...e, start: Math.max(0, e.start), pitch: Math.round(e.pitch) }))
    .filter((e) => e.pitch >= MIN_PITCH && e.pitch <= MAX_PITCH);
  const merged = mergeFragments(valid, o.mergeGap, o.reattackOnset);
  const noGhosts = dropHarmonicGhosts(merged, o.ghostMaxOnset, o.ghostAmplitudeRatio);
  return noGhosts
    .filter((e) => e.onsetStrength === undefined || e.onsetStrength >= o.minOnset)
    .filter((e) => e.duration >= o.minDuration);
}

/** Raw events → cleaned, hand-assigned Score. */
export function postprocess(events: RawNoteEvent[], opts: Partial<PostprocessOptions> = {}): Score {
  const o = { ...DEFAULT_POSTPROCESS, ...opts };
  const kept = cleanEvents(events, o);
  const velocities = amplitudesToVelocities(
    kept.map((e) => e.amplitude),
    o.minVelocity,
    o.maxVelocity,
  );
  const notes: Note[] = kept.map((e, i) => ({
    pitch: e.pitch,
    start: round6(e.start),
    duration: round6(e.duration),
    velocity: velocities[i]!,
    hand: null,
    track: 0,
  }));
  const score = createScore({ title: o.title, notes, tracks: [{ name: 'Piano' }] });
  return assignHands(score, { splitPitch: o.splitPitch });
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}
