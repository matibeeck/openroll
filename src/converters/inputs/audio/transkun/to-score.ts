/**
 * Transkun events → Score. Pure (Node tests import it). Unlike Basic Pitch's output, Transkun's
 * notes need no clean-up rules (fragments, overtone ghosts): the semi-CRF decodes whole notes with
 * onsets, offsets and MIDI velocities. Only the conventions of the fast mode are applied:
 * velocities mapped into [0.35, 1] relative to the loudest note, hands from src/core/hands, and the
 * sustain pedal (track 0) as Score.pedal. The soft pedal (track 1) has no place in Score and is dropped.
 */
import { assignHands } from '../../../../core/hands';
import { createScore, MAX_PITCH, MIN_PITCH, type Note, type PedalSpan, type Score } from '../../../../core/score';
import { DEFAULT_POSTPROCESS } from '../postprocess';
import type { TranskunEvent } from './transcribe';

export const SUSTAIN_SYMBOL = -64;

export interface TranskunScoreOptions {
  title: string;
  splitPitch: number;
  minVelocity: number;
  maxVelocity: number;
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Sorted, non-overlapping spans (touching or overlapping spans merge). */
export function pedalSpans(events: TranskunEvent[]): PedalSpan[] {
  const spans = events
    .filter((e) => e.symbol === SUSTAIN_SYMBOL && e.end > e.start)
    .map((e) => ({ start: round6(e.start), end: round6(e.end) }))
    .sort((a, b) => a.start - b.start);
  const out: PedalSpan[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

export function transkunToScore(events: TranskunEvent[], opts: Partial<TranskunScoreOptions> = {}): Score {
  const o: TranskunScoreOptions = {
    title: opts.title ?? DEFAULT_POSTPROCESS.title,
    splitPitch: opts.splitPitch ?? DEFAULT_POSTPROCESS.splitPitch,
    minVelocity: opts.minVelocity ?? DEFAULT_POSTPROCESS.minVelocity,
    maxVelocity: opts.maxVelocity ?? DEFAULT_POSTPROCESS.maxVelocity,
  };
  const kept = events.filter(
    (e) => e.symbol >= MIN_PITCH && e.symbol <= MAX_PITCH && Number.isFinite(e.start) && e.end > e.start,
  );
  const loudest = kept.reduce((m, e) => Math.max(m, e.velocity), 0);
  const notes: Note[] = kept.map((e) => ({
    pitch: e.symbol,
    start: round6(Math.max(0, e.start)),
    duration: round6(e.end - Math.max(0, e.start)),
    velocity:
      loudest > 0
        ? Math.round((o.minVelocity + ((o.maxVelocity - o.minVelocity) * Math.max(0, e.velocity)) / loudest) * 1000) / 1000
        : (o.minVelocity + o.maxVelocity) / 2,
    hand: null,
    track: 0,
  }));
  const pedal = pedalSpans(events);
  const score = createScore({ title: o.title, notes, tracks: [{ name: 'Piano' }], ...(pedal.length ? { pedal } : {}) });
  return assignHands(score, { splitPitch: o.splitPitch });
}
