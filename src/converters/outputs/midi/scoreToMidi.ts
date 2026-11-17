import type { Hand, Note, Score, TempoEvent } from '../../../core/score';
import { normalizeTempos, secondsToBeats } from '../../../core/tempo';
import { encodeSmf, type SmfEvent } from './smf';

export interface ScoreToMidiOptions {
  /** 1 (default): conductor track + one track per part/hand. 0: a single merged track. */
  format?: 0 | 1;
  /** Ticks per quarter note. Default 960 (≤ 0.8 ms rounding even at 40 BPM). */
  ppq?: number;
  /**
   * When a Score track holds notes of both hands, write one MIDI track per hand named
   * "<track> - Right hand" / "<track> - Left hand" so other apps (and our importer) keep the
   * hands. Default true.
   */
  splitHands?: boolean;
}

const HAND_ORDER: Hand[] = ['R', 'L', null];
const HAND_SUFFIX: Record<'L' | 'R', string> = { R: 'Right hand', L: 'Left hand' };

interface TickTempo {
  tick: number;
  usPerQuarter: number;
}

/**
 * Snap a tempo map to what a MIDI file can store: integer microseconds per quarter at integer
 * ticks. Returns both the tick events and the equivalent seconds-based map, which is exactly
 * what a reader will reconstruct, so note ticks computed against it round-trip.
 */
export function snapTempoMap(tempos: TempoEvent[], ppq: number): { ticks: TickTempo[]; seconds: TempoEvent[] } {
  const norm = normalizeTempos(tempos);
  const ticks: TickTempo[] = [];
  for (const t of norm) {
    const tick = Math.round(secondsToBeats(norm, t.time) * ppq);
    const usPerQuarter = Math.min(0xffffff, Math.max(1, Math.round(60_000_000 / t.bpm)));
    const prev = ticks[ticks.length - 1];
    if (prev && prev.tick === tick) prev.usPerQuarter = usPerQuarter;
    else ticks.push({ tick, usPerQuarter });
  }
  const seconds: TempoEvent[] = [];
  let time = 0;
  for (let i = 0; i < ticks.length; i++) {
    const t = ticks[i]!;
    if (i > 0) {
      const p = ticks[i - 1]!;
      time += ((t.tick - p.tick) / ppq) * (p.usPerQuarter / 1e6);
    }
    seconds.push({ time, bpm: 60_000_000 / t.usPerQuarter });
  }
  return { ticks, seconds };
}

interface OutTrack {
  name: string;
  notes: Note[];
}

/** Group notes into output tracks: one per Score track, split by hand when it mixes hands. */
export function planTracks(score: Score, splitHands: boolean): OutTrack[] {
  const out: OutTrack[] = [];
  const byTrack = new Map<number, Note[]>();
  for (const n of score.notes) {
    const list = byTrack.get(n.track) ?? [];
    list.push(n);
    byTrack.set(n.track, list);
  }
  const trackIds = [...byTrack.keys()].sort((a, b) => a - b);
  for (const id of trackIds) {
    const notes = byTrack.get(id)!;
    const base = score.tracks[id]?.name?.trim() || `Track ${id + 1}`;
    const hands = new Set(notes.map((n) => n.hand));
    if (!splitHands || hands.size <= 1) {
      out.push({ name: base, notes });
      continue;
    }
    for (const h of HAND_ORDER) {
      const part = notes.filter((n) => n.hand === h);
      if (part.length === 0) continue;
      out.push({ name: h ? `${base} - ${HAND_SUFFIX[h]}` : base, notes: part });
    }
  }
  return out;
}

function channelFor(index: number): number {
  // 15 usable melodic channels: skip 9 (General MIDI percussion).
  const c = index % 15;
  return c >= 9 ? c + 1 : c;
}

/** Note events for one track. Overlapping repeats of a pitch are cut where the next one starts. */
function noteEvents(notes: Note[], channel: number, toTick: (s: number) => number): SmfEvent[] {
  const timed = notes
    .map((n) => {
      const start = toTick(n.start);
      return { pitch: n.pitch, start, end: Math.max(start + 1, toTick(n.start + n.duration)), velocity: n.velocity };
    })
    .sort((a, b) => a.pitch - b.pitch || a.start - b.start || b.end - a.end);
  const events: SmfEvent[] = [];
  for (let i = 0; i < timed.length; i++) {
    const n = timed[i]!;
    const next = timed[i + 1];
    if (next && next.pitch === n.pitch && next.start === n.start) {
      // Exact duplicate onset on the same channel cannot be represented; keep the longer one.
      next.end = Math.max(next.end, n.end);
      continue;
    }
    const end = next && next.pitch === n.pitch && next.start < n.end ? next.start : n.end;
    const velocity = Math.max(1, Math.min(127, Math.round(n.velocity * 127)));
    events.push({ tick: n.start, type: 'noteOn', channel, pitch: n.pitch, velocity });
    events.push({ tick: end, type: 'noteOff', channel, pitch: n.pitch });
  }
  return events;
}

/** CC64 down (127) / up (0) events for the Score's sustain pedal spans. */
function pedalEvents(score: Score, channel: number, toTick: (s: number) => number): SmfEvent[] {
  return (score.pedal ?? []).flatMap((p): SmfEvent[] => {
    const start = toTick(p.start);
    const end = Math.max(start + 1, toTick(p.end));
    return [
      { tick: start, type: 'controller', channel, controller: 64, value: 127 },
      { tick: end, type: 'controller', channel, controller: 64, value: 0 },
    ];
  });
}

/** Encode a Score as a Standard MIDI File. Preserves tempo map, time signature, key and sustain pedal. */
export function scoreToMidiBytes(score: Score, opts: ScoreToMidiOptions = {}): Uint8Array {
  const format = opts.format ?? 1;
  const ppq = opts.ppq ?? 960;
  const tempo = snapTempoMap(score.tempos, ppq);
  const toTick = (s: number) => Math.round(secondsToBeats(tempo.seconds, Math.max(0, s)) * ppq);

  const conductor: SmfEvent[] = [
    { tick: 0, type: 'trackName', text: score.title },
    { tick: 0, type: 'timeSignature', numerator: score.timeSignature.numerator, denominator: score.timeSignature.denominator },
    ...tempo.ticks.map((t): SmfEvent => ({ tick: t.tick, type: 'tempo', usPerQuarter: t.usPerQuarter })),
  ];
  if (score.key) conductor.push({ tick: 0, type: 'keySignature', fifths: score.key.fifths, minor: score.key.mode === 'minor' });

  const planned = planTracks(score, opts.splitHands ?? true);
  const tracks = planned.map((t, i) => {
    const channel = channelFor(i);
    const events: SmfEvent[] = [{ tick: 0, type: 'program', channel, program: 0 }, ...noteEvents(t.notes, channel, toTick)];
    // Sustain pedal (CC64) goes on the first part's channel.
    if (i === 0) events.push(...pedalEvents(score, channel, toTick));
    return { name: t.name, events };
  });

  if (format === 0) {
    return encodeSmf({ format: 0, ppq, tracks: [[...conductor, ...tracks.flatMap((t) => t.events)]] });
  }
  return encodeSmf({
    format: 1,
    ppq,
    tracks: [conductor, ...tracks.map((t) => [{ tick: 0, type: 'trackName', text: t.name } as SmfEvent, ...t.events])],
  });
}
