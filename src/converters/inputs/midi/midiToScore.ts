import { Midi } from '@tonejs/midi';
import { assignHands } from '../../../core/hands';
import {
  createScore,
  MAX_PITCH,
  MIN_PITCH,
  type KeySignature,
  type Note,
  type PedalSpan,
  type Score,
  type TimeSignature,
  type TrackInfo,
} from '../../../core/score';
import { DEFAULT_BPM, normalizeTempos } from '../../../core/tempo';

export interface MidiToScoreOptions {
  /** Assign hands (track names, else pitch split). Default true. */
  hands?: boolean;
  /** Split pitch for hand assignment. Default 60 (C4). */
  splitPitch?: number;
  /**
   * Override the TrackInfo of a file track (index into the parsed tracks, conductor track
   * excluded). Used by the MusicXML importer to map staves to hands.
   */
  trackInfo?: (fileTrackIndex: number, name: string) => TrackInfo;
  /**
   * Ticks to add back to every note's length. Verovio's MIDI export shortens each note by one
   * tick; the MusicXML importer passes 1 to recover the notated duration. Default 0.
   */
  durationPadTicks?: number;
}

/** Same order @tonejs/midi uses: index = fifths + 7. */
const KEY_NAMES = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const PERCUSSION_CHANNEL = 9;
/** Floor for zero-length MIDI notes so Score.duration stays > 0. */
const MIN_DURATION = 0.001;

export class MidiParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MidiParseError';
  }
}

export function isMidiBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 14 && bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64;
}

export function keyFromName(key: string, scale: string): KeySignature | undefined {
  const idx = KEY_NAMES.indexOf(key);
  if (idx < 0) return undefined;
  return { fifths: idx - 7, mode: scale === 'minor' ? 'minor' : 'major' };
}

/**
 * Sustain pedal spans from CC64 (down at ≥ 64) on any melodic channel, merged across tracks.
 * A pedal still down at the end of the file is released at the end of the file.
 */
export function sustainSpans(midi: Midi): PedalSpan[] {
  const spans: PedalSpan[] = [];
  for (const t of midi.tracks) {
    if (t.channel === PERCUSSION_CHANNEL) continue;
    const ccs = [...(t.controlChanges[64] ?? [])].sort((a, b) => a.ticks - b.ticks);
    let down: number | null = null;
    for (const cc of ccs) {
      const isDown = cc.value >= 64 / 127 - 1e-6;
      if (isDown && down === null) down = cc.time;
      else if (!isDown && down !== null) {
        if (cc.time > down) spans.push({ start: down, end: cc.time });
        down = null;
      }
    }
    if (down !== null && midi.duration > down) spans.push({ start: down, end: midi.duration });
  }
  spans.sort((a, b) => a.start - b.start);
  const merged: PedalSpan[] = [];
  for (const s of spans) {
    const prev = merged[merged.length - 1];
    if (prev && s.start <= prev.end) prev.end = Math.max(prev.end, s.end);
    else merged.push({ ...s });
  }
  return merged;
}

/**
 * Parse a Standard MIDI File (format 0 or 1) into a Score.
 * - Times come from the file's tempo map (seconds); the tempo map is kept in Score.tempos.
 * - Percussion (channel 10) and pitches outside the piano range (21–108) are dropped.
 * - The first time signature and key signature are kept; sustain pedal (CC64) becomes Score.pedal.
 * - Empty tracks are dropped; track names are kept for hand assignment.
 */
export function midiBytesToScore(bytes: Uint8Array, title?: string, opts: MidiToScoreOptions = {}): Score {
  if (!isMidiBytes(bytes)) throw new MidiParseError('Not a MIDI file (missing MThd header)');
  let midi: Midi;
  try {
    midi = new Midi(bytes);
  } catch (e) {
    throw new MidiParseError(`Could not read MIDI file: ${e instanceof Error ? e.message : String(e)}`);
  }
  const format = (bytes[8]! << 8) | bytes[9]!;

  const pad = opts.durationPadTicks ?? 0;
  const tracks: TrackInfo[] = [];
  const notes: Note[] = [];
  midi.tracks.forEach((t, fileTrackIndex) => {
    if (t.channel === PERCUSSION_CHANNEL) return;
    const kept = t.notes.filter((n) => n.midi >= MIN_PITCH && n.midi <= MAX_PITCH);
    if (kept.length === 0) return;
    const index = tracks.length;
    const name = t.name.trim() || `Track ${index + 1}`;
    tracks.push(opts.trackInfo ? opts.trackInfo(fileTrackIndex, name) : { name });
    for (const n of kept) {
      notes.push({
        pitch: n.midi,
        start: n.time,
        duration: Math.max(
          MIN_DURATION,
          pad ? midi.header.ticksToSeconds(n.ticks + n.durationTicks + pad) - n.time : n.duration,
        ),
        velocity: Math.min(1, Math.max(0, n.velocity)),
        hand: null,
        track: index,
      });
    }
  });

  const pedal = sustainSpans(midi);

  const header = midi.header;
  const tempos = normalizeTempos(
    header.tempos.map((t) => ({ time: t.time ?? header.ticksToSeconds(t.ticks), bpm: t.bpm })),
  );
  if (header.tempos.length === 0) tempos[0]!.bpm = DEFAULT_BPM;

  const ts = [...header.timeSignatures].sort((a, b) => a.ticks - b.ticks)[0];
  const timeSignature: TimeSignature =
    ts && ts.timeSignature[0] && ts.timeSignature[1]
      ? { numerator: ts.timeSignature[0], denominator: ts.timeSignature[1] }
      : { numerator: 4, denominator: 4 };
  const ks = [...header.keySignatures].sort((a, b) => a.ticks - b.ticks)[0];
  const key = ks ? keyFromName(ks.key, ks.scale) : undefined;

  // In format 1 the first track's name is the song title only when that track is a conductor
  // track (no notes); otherwise it is just the name of a part.
  const embedded = header.name.trim();
  const embeddedIsPart = format === 1 && midi.tracks.some((t) => t.notes.length > 0 && t.name.trim() === embedded);
  const finalTitle = (!embeddedIsPart && embedded) || title?.trim() || 'Untitled';

  const score = createScore({
    title: finalTitle,
    notes,
    tracks: tracks.length > 0 ? tracks : [{ name: 'Piano' }],
    tempos,
    timeSignature,
    ...(key ? { key } : {}),
    ...(pedal.length ? { pedal } : {}),
  });
  return opts.hands === false ? score : assignHands(score, { splitPitch: opts.splitPitch });
}
