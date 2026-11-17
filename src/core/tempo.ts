import type { TempoEvent } from './score';

/** Default tempo when a source gives none (the MIDI default). */
export const DEFAULT_BPM = 120;

/**
 * Sorted copy of a tempo map with exactly one entry at time 0 and no duplicate times
 * (the later entry at the same time wins). Non-positive or non-finite BPMs are dropped.
 * `bpm` is quarter notes per minute, as in MIDI.
 */
export function normalizeTempos(tempos: TempoEvent[]): TempoEvent[] {
  const valid = tempos
    .filter((t) => Number.isFinite(t.bpm) && t.bpm > 0 && Number.isFinite(t.time))
    .map((t) => ({ time: Math.max(0, t.time), bpm: t.bpm }))
    .sort((a, b) => a.time - b.time);
  const out: TempoEvent[] = [];
  for (const t of valid) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.time - t.time) < 1e-9) prev.bpm = t.bpm;
    else out.push(t);
  }
  if (out.length === 0 || out[0]!.time > 1e-9) out.unshift({ time: 0, bpm: out[0]?.bpm ?? DEFAULT_BPM });
  out[0]!.time = 0;
  return out;
}

/** Quarter-note beats elapsed at `seconds` under a normalized tempo map. */
export function secondsToBeats(tempos: TempoEvent[], seconds: number): number {
  let beats = 0;
  for (let i = 0; i < tempos.length; i++) {
    const t = tempos[i]!;
    const next = tempos[i + 1];
    if (next && next.time <= seconds) {
      beats += ((next.time - t.time) * t.bpm) / 60;
    } else {
      return beats + ((seconds - t.time) * t.bpm) / 60;
    }
  }
  return beats;
}

/** Seconds at a given quarter-note beat position under a normalized tempo map. */
export function beatsToSeconds(tempos: TempoEvent[], beats: number): number {
  let acc = 0;
  for (let i = 0; i < tempos.length; i++) {
    const t = tempos[i]!;
    const next = tempos[i + 1];
    const segBeats = next ? ((next.time - t.time) * t.bpm) / 60 : Infinity;
    if (beats - acc <= segBeats) return t.time + ((beats - acc) * 60) / t.bpm;
    acc += segBeats;
  }
  return 0;
}
