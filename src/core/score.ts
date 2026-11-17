/**
 * Canonical Score model. Every input converts to Score; every output reads from Score.
 * Times are in seconds. Ticks/beats only exist at format edges (MIDI, MusicXML).
 */
export type Hand = 'L' | 'R' | null;

export interface Note {
  /** MIDI pitch, 21 (A0) … 108 (C8). */
  pitch: number;
  /** Onset in seconds. */
  start: number;
  /** Duration in seconds (> 0). */
  duration: number;
  /** 0–1. */
  velocity: number;
  hand: Hand;
  /** Index into Score.tracks. */
  track: number;
}

export interface TempoEvent {
  /** Seconds. */
  time: number;
  bpm: number;
}

export interface TimeSignature {
  numerator: number;
  denominator: number;
}

export interface KeySignature {
  /** Circle-of-fifths position: -7 (7 flats) … +7 (7 sharps). */
  fifths: number;
  mode: 'major' | 'minor';
}

export interface TrackInfo {
  name: string;
  /** Hand hint derived from the track/staff name, if any. */
  hand?: Hand;
}

export interface Score {
  title: string;
  /** Sorted by start, then pitch. */
  notes: Note[];
  tracks: TrackInfo[];
  /** At least one entry at time 0. */
  tempos: TempoEvent[];
  timeSignature: TimeSignature;
  key?: KeySignature;
}

export const MIN_PITCH = 21;
export const MAX_PITCH = 108;

export function sortNotes(notes: Note[]): Note[] {
  return notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

export function scoreDuration(score: Score): number {
  let end = 0;
  for (const n of score.notes) end = Math.max(end, n.start + n.duration);
  return end;
}

export function emptyScore(title = 'Untitled'): Score {
  return {
    title,
    notes: [],
    tracks: [{ name: 'Piano' }],
    tempos: [{ time: 0, bpm: 120 }],
    timeSignature: { numerator: 4, denominator: 4 },
  };
}

export function createScore(partial: Partial<Score> & Pick<Score, 'notes'>): Score {
  const base = emptyScore(partial.title);
  return { ...base, ...partial, notes: sortNotes([...partial.notes]) };
}
