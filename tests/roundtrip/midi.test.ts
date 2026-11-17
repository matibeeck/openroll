import { describe, expect, it } from 'vitest';
import { midiBytesToScore, MidiParseError } from '../../src/converters/inputs/midi';
import { scoreToMidiBytes } from '../../src/converters/outputs/midi';
import { encodeSmf, type SmfEvent } from '../../src/converters/outputs/midi/smf';
import { createScore, type Note, type Score } from '../../src/core/score';
import { allPieces, pieceToScore } from '../fixtures/music';
import { noteF1 } from './metrics';

const MS = 0.001;

/** Compare two scores note by note: same count, pitch exact, times within `tol`, velocity within 1/127. */
function expectSameNotes(a: Score, b: Score, opts: { tol?: number; hands?: boolean } = {}): number {
  const tol = opts.tol ?? MS;
  expect(b.notes.length).toBe(a.notes.length);
  let maxErr = 0;
  a.notes.forEach((x, i) => {
    const y = b.notes[i]!;
    expect(y.pitch).toBe(x.pitch);
    maxErr = Math.max(maxErr, Math.abs(y.start - x.start), Math.abs(y.start + y.duration - (x.start + x.duration)));
    expect(Math.abs(y.velocity - x.velocity)).toBeLessThanOrEqual(1 / 127 + 1e-9);
    if (opts.hands !== false) expect(y.hand).toBe(x.hand);
  });
  expect(maxErr).toBeLessThanOrEqual(tol);
  return maxErr;
}

function report(name: string, a: Score, b: Score, maxErr: number): void {
  const m = noteF1(a.notes, b.notes, MS);
  console.log(
    `[midi round-trip] ${name}: notes ${a.notes.length}→${b.notes.length}, F1 ${m.f1.toFixed(3)} (onset ±1 ms), max time error ${(maxErr * 1000).toFixed(3)} ms`,
  );
  expect(m.f1).toBe(1);
}

// ---------------------------------------------------------------- hand-built source files

const PPQ = 480;
/** Tempo map in ticks: 120 BPM, 90 BPM from beat 4, 150 BPM from beat 8. */
const TEMPO_TICKS = [
  { tick: 0, bpm: 120 },
  { tick: 4 * PPQ, bpm: 90 },
  { tick: 8 * PPQ, bpm: 150 },
];

/** Independent tick → seconds for the map above (straightforward segment sum). */
function tickToSec(tick: number): number {
  let sec = 0;
  for (let i = 0; i < TEMPO_TICKS.length; i++) {
    const seg = TEMPO_TICKS[i]!;
    const nextTick = TEMPO_TICKS[i + 1]?.tick ?? Infinity;
    const span = Math.min(tick, nextTick) - seg.tick;
    if (span <= 0) break;
    // A MIDI file stores integer microseconds per quarter note.
    sec += (span / PPQ) * (Math.round(60_000_000 / seg.bpm) / 1e6);
  }
  return sec;
}

interface TickNote {
  pitch: number;
  tick: number;
  ticks: number;
  velocity: number;
  /** 0 = right hand part, 1 = left hand part. */
  part: 0 | 1;
}

/** Twelve beats: RH eighth-note line + LH half-note chords, crossing both tempo changes. */
function sourceNotes(): TickNote[] {
  const notes: TickNote[] = [];
  const rh = [72, 74, 76, 77, 79, 77, 76, 74];
  for (let i = 0; i < 24; i++) {
    notes.push({ pitch: rh[i % rh.length]!, tick: i * (PPQ / 2), ticks: PPQ / 2 - 10, velocity: 64 + (i % 5) * 10, part: 0 });
  }
  const lh = [
    [48, 55],
    [53, 57],
    [55, 59],
    [48, 52],
    [45, 52],
    [43, 50],
  ];
  lh.forEach((chord, i) => {
    for (const pitch of chord) notes.push({ pitch, tick: i * 2 * PPQ, ticks: 2 * PPQ, velocity: 50, part: 1 });
  });
  // A same-tick repeated note boundary (note-off and note-on on one tick).
  notes.push({ pitch: 60, tick: 11 * PPQ, ticks: PPQ / 2, velocity: 100, part: 0 });
  notes.push({ pitch: 60, tick: 11 * PPQ + PPQ / 2, ticks: PPQ / 2, velocity: 100, part: 0 });
  return notes;
}

function noteEvents(n: TickNote, channel: number): SmfEvent[] {
  return [
    { tick: n.tick, type: 'noteOn', channel, pitch: n.pitch, velocity: n.velocity },
    { tick: n.tick + n.ticks, type: 'noteOff', channel, pitch: n.pitch },
  ];
}

const META: SmfEvent[] = [
  { tick: 0, type: 'timeSignature', numerator: 3, denominator: 4 },
  { tick: 0, type: 'keySignature', fifths: -3, minor: true },
  ...TEMPO_TICKS.map((t): SmfEvent => ({ tick: t.tick, type: 'tempo', usPerQuarter: 60_000_000 / t.bpm })),
];

function format1Source(): Uint8Array {
  const notes = sourceNotes();
  return encodeSmf({
    format: 1,
    ppq: PPQ,
    tracks: [
      [{ tick: 0, type: 'trackName', text: 'Etude in C minor' }, ...META],
      [{ tick: 0, type: 'trackName', text: 'Piano RH' }, ...notes.filter((n) => n.part === 0).flatMap((n) => noteEvents(n, 0))],
      [{ tick: 0, type: 'trackName', text: 'Piano LH' }, ...notes.filter((n) => n.part === 1).flatMap((n) => noteEvents(n, 1))],
    ],
  });
}

function format0Source(): Uint8Array {
  const notes = sourceNotes();
  return encodeSmf({
    format: 0,
    ppq: PPQ,
    tracks: [[{ tick: 0, type: 'trackName', text: 'Etude in C minor' }, ...META, ...notes.flatMap((n) => noteEvents(n, n.part))]],
  });
}

function expectedNotes(): { pitch: number; start: number; end: number; velocity: number; hand: 'L' | 'R' }[] {
  return sourceNotes()
    .map((n) => ({
      pitch: n.pitch,
      start: tickToSec(n.tick),
      end: tickToSec(n.tick + n.ticks),
      velocity: n.velocity / 127,
      hand: n.part === 0 ? ('R' as const) : ('L' as const),
    }))
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

// ---------------------------------------------------------------- tests

describe('MIDI import', () => {
  it.each([
    ['format 1', format1Source],
    ['format 0', format0Source],
  ])('%s: notes, tempo map, time signature and key match the file', (_name, build) => {
    const bytes = build();
    expect(bytes[9]).toBe(_name === 'format 0' ? 0 : 1);
    const score = midiBytesToScore(bytes, 'fallback');
    const expected = expectedNotes();

    expect(score.title).toBe('Etude in C minor');
    expect(score.timeSignature).toEqual({ numerator: 3, denominator: 4 });
    expect(score.key).toEqual({ fifths: -3, mode: 'minor' });
    expect(score.tempos.map((t) => +t.bpm.toFixed(3))).toEqual([120, 90, 150]);
    score.tempos.forEach((t, i) => expect(t.time).toBeCloseTo(tickToSec(TEMPO_TICKS[i]!.tick), 9));

    expect(score.notes.length).toBe(expected.length);
    score.notes.forEach((n, i) => {
      const e = expected[i]!;
      expect(n.pitch).toBe(e.pitch);
      expect(n.start).toBeCloseTo(e.start, 9);
      expect(n.start + n.duration).toBeCloseTo(e.end, 9);
      expect(n.velocity).toBeCloseTo(e.velocity, 9);
    });
    if (_name === 'format 1') {
      // Hands come from the track names "Piano RH" / "Piano LH".
      score.notes.forEach((n, i) => expect(n.hand).toBe(expected[i]!.hand));
      expect(score.tracks.map((t) => t.name)).toEqual(['Piano RH', 'Piano LH']);
    }
  });

  it('drops percussion and out-of-range pitches, never invents notes', () => {
    const bytes = encodeSmf({
      format: 0,
      ppq: 96,
      tracks: [
        [
          { tick: 0, type: 'noteOn', channel: 0, pitch: 60, velocity: 80 },
          { tick: 96, type: 'noteOff', channel: 0, pitch: 60 },
          { tick: 0, type: 'noteOn', channel: 0, pitch: 12, velocity: 80 },
          { tick: 96, type: 'noteOff', channel: 0, pitch: 12 },
          { tick: 0, type: 'noteOn', channel: 9, pitch: 38, velocity: 80 },
          { tick: 96, type: 'noteOff', channel: 9, pitch: 38 },
        ],
      ],
    });
    const score = midiBytesToScore(bytes, 'drums');
    expect(score.notes.map((n) => n.pitch)).toEqual([60]);
    expect(score.title).toBe('drums');
    expect(score.tempos).toEqual([{ time: 0, bpm: 120 }]);
    expect(score.timeSignature).toEqual({ numerator: 4, denominator: 4 });
  });

  it('rejects non-MIDI bytes with a clear error', () => {
    expect(() => midiBytesToScore(new TextEncoder().encode('hello world, not midi'))).toThrow(MidiParseError);
  });
});

describe('MIDI → Score → MIDI → Score', () => {
  it.each([
    ['format 1 source → format 1', format1Source, 1],
    ['format 1 source → format 0', format1Source, 0],
    ['format 0 source → format 1', format0Source, 1],
    ['format 0 source → format 0', format0Source, 0],
  ] as const)('%s is identical within 1 ms', (name, build, outFormat) => {
    const a = midiBytesToScore(build());
    const bytes = scoreToMidiBytes(a, { format: outFormat });
    expect(bytes[9]).toBe(outFormat);
    const b = midiBytesToScore(bytes);
    // Format 0 output has a single track, so hands come from the (deterministic) pitch split.
    const maxErr = expectSameNotes(a, b, { hands: outFormat === 1 });
    expect(b.title).toBe(a.title);
    expect(b.timeSignature).toEqual(a.timeSignature);
    expect(b.key).toEqual(a.key);
    expect(b.tempos.length).toBe(a.tempos.length);
    b.tempos.forEach((t, i) => {
      expect(t.bpm).toBeCloseTo(a.tempos[i]!.bpm, 6);
      expect(Math.abs(t.time - a.tempos[i]!.time)).toBeLessThanOrEqual(MS);
    });
    report(name, a, b, maxErr);
  });

  it('is stable: a second export produces the same bytes', () => {
    const a = midiBytesToScore(format1Source());
    const once = scoreToMidiBytes(a);
    const twice = scoreToMidiBytes(midiBytesToScore(once));
    expect([...twice]).toEqual([...once]);
  });
});

describe('Score → MIDI → Score', () => {
  it.each(allPieces.map((p) => [p.title, p] as const))('fixture "%s" survives within 1 ms with hands', (title, piece) => {
    const a = pieceToScore(piece);
    const b = midiBytesToScore(scoreToMidiBytes(a));
    const maxErr = expectSameNotes(a, b);
    expect(b.title).toBe(title);
    expect(b.key).toEqual(a.key);
    expect(b.timeSignature).toEqual(a.timeSignature);
    report(title, a, b, maxErr);
  });

  it('keeps a tempo map with changes at arbitrary times and slow tempos', () => {
    const tempos = [
      { time: 0, bpm: 41.7 },
      { time: 2.3456, bpm: 73.3 },
      { time: 5.1, bpm: 181 },
      { time: 7.77, bpm: 60 },
    ];
    const notes: Note[] = [];
    for (let i = 0; i < 120; i++) {
      const start = i * 0.0917 + (i % 7) * 0.0031;
      notes.push({ pitch: 40 + ((i * 7) % 50), start, duration: 0.05 + (i % 9) * 0.07, velocity: ((i * 13) % 127) / 127 + 0.004, hand: i % 2 ? 'L' : 'R', track: 0 });
    }
    const a = createScore({ title: 'tempo torture', notes, tempos, tracks: [{ name: 'Piano' }] });
    const b = midiBytesToScore(scoreToMidiBytes(a));
    // Mixed hands on one track are written as two hand tracks, so hands survive.
    expect(b.tracks.map((t) => t.name)).toEqual(['Piano - Right hand', 'Piano - Left hand']);
    const maxErr = expectSameNotes(a, b);
    b.tempos.forEach((t, i) => {
      expect(Math.abs(t.bpm - tempos[i]!.bpm)).toBeLessThan(0.01);
      expect(Math.abs(t.time - tempos[i]!.time)).toBeLessThanOrEqual(MS);
    });
    report('tempo torture', a, b, maxErr);
  });

  it('writes every key signature with the right sign', () => {
    for (let fifths = -7; fifths <= 7; fifths++) {
      for (const mode of ['major', 'minor'] as const) {
        const a = createScore({ notes: [{ pitch: 60, start: 0, duration: 1, velocity: 0.5, hand: 'R', track: 0 }], key: { fifths, mode } });
        expect(midiBytesToScore(scoreToMidiBytes(a)).key).toEqual({ fifths, mode });
      }
    }
  });

  it('cuts an overlapping repeat of the same pitch where the next one starts', () => {
    const notes: Note[] = [
      { pitch: 64, start: 0, duration: 2, velocity: 0.5, hand: 'R', track: 0 },
      { pitch: 64, start: 1, duration: 1, velocity: 0.5, hand: 'R', track: 0 },
    ];
    const b = midiBytesToScore(scoreToMidiBytes(createScore({ notes })));
    expect(b.notes.map((n) => [n.start, +n.duration.toFixed(6)])).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });
});

describe('sustain pedal (CC64)', () => {
  it('Score.pedal → MIDI → Score keeps the spans within 1 ms', () => {
    const notes: Note[] = [0, 0.5, 1, 1.5].map((t, i) => ({ pitch: 60 + i, start: t, duration: 0.2, velocity: 0.7, hand: 'R', track: 0 }));
    const pedal = [
      { start: 0.01, end: 0.95 },
      { start: 1.02, end: 2.0 },
    ];
    for (const format of [0, 1] as const) {
      const back = midiBytesToScore(scoreToMidiBytes(createScore({ notes, pedal }), { format }));
      expect(back.pedal?.length).toBe(2);
      back.pedal!.forEach((p, i) => {
        expect(Math.abs(p.start - pedal[i]!.start)).toBeLessThanOrEqual(MS);
        expect(Math.abs(p.end - pedal[i]!.end)).toBeLessThanOrEqual(MS);
      });
    }
    // No pedal → no field.
    expect(midiBytesToScore(scoreToMidiBytes(createScore({ notes }))).pedal).toBeUndefined();
  });

  it('reads CC64 written by another app, merging half-pedal values at ≥ 64 as down', () => {
    const bytes = encodeSmf({
      format: 0,
      ppq: 480,
      tracks: [
        [
          { tick: 0, type: 'noteOn', channel: 0, pitch: 60, velocity: 80 },
          { tick: 0, type: 'controller', channel: 0, controller: 64, value: 100 },
          { tick: 240, type: 'controller', channel: 0, controller: 64, value: 70 }, // still down
          { tick: 480, type: 'noteOff', channel: 0, pitch: 60 },
          { tick: 960, type: 'controller', channel: 0, controller: 64, value: 10 },
        ],
      ],
    });
    expect(midiBytesToScore(bytes).pedal).toEqual([{ start: 0, end: 1 }]);
  });
});
