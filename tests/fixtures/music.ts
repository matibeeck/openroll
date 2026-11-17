/**
 * Music fixtures generated in code (no copyrighted material). Each piece is described once as
 * measures of per-staff events; from that single description we build both the expected Score
 * and a hand-written-by-code MusicXML 4.0 document.
 *
 * Durations are in divisions of a quarter note (DIVISIONS = 4: 16th = 1, 8th = 2, quarter = 4).
 */
import { createScore, type Hand, type Note, type Score } from '../../src/core/score';

export const DIVISIONS = 4;

export interface FixtureEvent {
  /** MIDI pitches; empty = rest. More than one = chord. */
  pitches: number[];
  /** Duration in divisions. */
  dur: number;
  /** Tie every pitch of this event to the next event of the same staff (same pitches). */
  tie?: boolean;
}

export interface FixturePiece {
  title: string;
  bpm: number;
  beats: number;
  beatType: number;
  /** Key signature, circle of fifths. */
  fifths: number;
  /** One entry per measure; each holds one event list per staff (staff 1 = treble/right hand). */
  measures: FixtureEvent[][][];
}

// ---------------------------------------------------------------- note helpers

const STEP_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Scientific pitch name → MIDI number, e.g. "C4" = 60, "F#5" = 78, "Bb3" = 58. */
export function p(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad pitch ${name}`);
  const alter = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + STEP_SEMITONES[m[1]!]! + alter;
}

/** Event shorthand: ev('D5', 4), ev(['G3','B3','D4'], 8), ev([], 4) for a rest. */
export function ev(pitches: string | string[], dur: number, tie = false): FixtureEvent {
  const list = typeof pitches === 'string' ? [pitches] : pitches;
  return { pitches: list.map(p), dur, ...(tie ? { tie } : {}) };
}

const Q = 4;
const E = 2;
const H = 8;
const HD = 12;
const W = 16;

// ---------------------------------------------------------------- pieces

/** C major scale, one octave up and down, right hand only. */
export const cMajorScale: FixturePiece = {
  title: 'C major scale',
  bpm: 120,
  beats: 4,
  beatType: 4,
  fifths: 0,
  measures: [
    [[ev('C4', Q), ev('D4', Q), ev('E4', Q), ev('F4', Q)]],
    [[ev('G4', Q), ev('A4', Q), ev('B4', Q), ev('C5', Q)]],
    [[ev('B4', Q), ev('A4', Q), ev('G4', Q), ev('F4', Q)]],
    [[ev('E4', Q), ev('D4', Q), ev('C4', H)]],
  ],
};

/** I–IV–V–V7–I in C: block chords in the right hand, roots in the left, a rest and a tie across the barline. */
export const chordProgression: FixturePiece = {
  title: 'Chord progression in C',
  bpm: 90,
  beats: 4,
  beatType: 4,
  fifths: 0,
  measures: [
    [[ev(['C4', 'E4', 'G4'], H), ev(['C4', 'E4', 'G4'], H)], [ev('C3', W)]],
    [[ev(['C4', 'F4', 'A4'], H), ev(['C4', 'F4', 'A4'], H)], [ev('F2', W)]],
    [[ev(['B3', 'D4', 'G4'], H), ev(['B3', 'D4', 'F4'], H)], [ev('G2', W)]],
    [[ev(['C4', 'E4', 'G4'], H), ev([], H)], [ev('C3', W, true)]],
    [[ev(['E4', 'G4', 'C5'], W)], [ev('C3', W)]],
  ],
};

/**
 * Minuet in G, BWV Anh. 114 (Christian Petzold, from the 1725 Notebook for Anna Magdalena Bach;
 * public domain). First 16 bars, entered note by note. The bass line follows the common
 * teaching layout (chord on the first beat, mostly dotted halves).
 */
export const minuetInG: FixturePiece = {
  title: 'Minuet in G (BWV Anh. 114)',
  bpm: 120,
  beats: 3,
  beatType: 4,
  fifths: 1,
  measures: [
    [[ev('D5', Q), ev('G4', E), ev('A4', E), ev('B4', E), ev('C5', E)], [ev(['G3', 'B3', 'D4'], H), ev('A3', Q)]],
    [[ev('D5', Q), ev('G4', Q), ev('G4', Q)], [ev('B3', HD)]],
    [[ev('E5', Q), ev('C5', E), ev('D5', E), ev('E5', E), ev('F#5', E)], [ev('C4', HD)]],
    [[ev('G5', Q), ev('G4', Q), ev('G4', Q)], [ev('B3', HD)]],
    [[ev('C5', Q), ev('D5', E), ev('C5', E), ev('B4', E), ev('A4', E)], [ev('A3', HD)]],
    [[ev('B4', Q), ev('C5', E), ev('B4', E), ev('A4', E), ev('G4', E)], [ev('G3', HD)]],
    [[ev('F#4', Q), ev('G4', E), ev('A4', E), ev('B4', E), ev('G4', E)], [ev('D4', Q), ev('B3', Q), ev('G3', Q)]],
    [[ev('A4', HD)], [ev('D4', Q), ev('D3', Q), ev('C4', Q)]],
    [[ev('D5', Q), ev('G4', E), ev('A4', E), ev('B4', E), ev('C5', E)], [ev('B3', H), ev('A3', Q)]],
    [[ev('D5', Q), ev('G4', Q), ev('G4', Q)], [ev('G3', HD)]],
    [[ev('E5', Q), ev('C5', E), ev('D5', E), ev('E5', E), ev('F#5', E)], [ev('C4', HD)]],
    [[ev('G5', Q), ev('G4', Q), ev('G4', Q)], [ev('B3', Q), ev('C4', E), ev('B3', E), ev('A3', E), ev('G3', E)]],
    [[ev('C5', Q), ev('D5', E), ev('C5', E), ev('B4', E), ev('A4', E)], [ev('A3', H), ev('F#3', Q)]],
    [[ev('B4', Q), ev('C5', E), ev('B4', E), ev('A4', E), ev('G4', E)], [ev('G3', H), ev('B3', Q)]],
    [[ev('A4', Q), ev('B4', E), ev('A4', E), ev('G4', E), ev('F#4', E)], [ev('C4', Q), ev('D4', Q), ev('D3', Q)]],
    [[ev('G4', HD)], [ev('G3', H), ev('G2', Q)]],
  ],
};

export const allPieces: FixturePiece[] = [cMajorScale, chordProgression, minuetInG];

// ---------------------------------------------------------------- Score builder

export function staffCount(piece: FixturePiece): number {
  return Math.max(...piece.measures.map((m) => m.length));
}

/** Measure length in divisions. */
export function measureDivisions(piece: FixturePiece): number {
  return (piece.beats * 4 * DIVISIONS) / piece.beatType;
}

/** Expected Score: staff 1 = right hand (track 0), staff 2 = left hand (track 1). Ties merged. */
export function pieceToScore(piece: FixturePiece, velocity = 0.8): Score {
  const staves = staffCount(piece);
  const secPerDiv = 60 / piece.bpm / DIVISIONS;
  const notes: Note[] = [];
  for (let s = 0; s < staves; s++) {
    const hand: Hand = s === 0 ? 'R' : 'L';
    let pos = 0;
    let open = new Map<number, Note>(); // pitch → note whose tie continues into the next event
    piece.measures.forEach((m) => {
      for (const e of m[s] ?? []) {
        const nextOpen = new Map<number, Note>();
        for (const pitch of e.pitches) {
          let note = open.get(pitch);
          if (note) {
            note.duration += e.dur * secPerDiv;
          } else {
            note = { pitch, start: pos * secPerDiv, duration: e.dur * secPerDiv, velocity, hand, track: s };
            notes.push(note);
          }
          if (e.tie) nextOpen.set(pitch, note);
        }
        open = nextOpen;
        pos += e.dur;
      }
    });
  }
  const tracks =
    staves === 1 ? [{ name: 'Right hand', hand: 'R' as const }] : [{ name: 'Right hand', hand: 'R' as const }, { name: 'Left hand', hand: 'L' as const }];
  return createScore({
    title: piece.title,
    notes,
    tracks,
    tempos: [{ time: 0, bpm: piece.bpm }],
    timeSignature: { numerator: piece.beats, denominator: piece.beatType },
    key: { fifths: piece.fifths, mode: 'major' },
  });
}

// ---------------------------------------------------------------- MusicXML generator

const SHARP_NAMES: [string, number][] = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
];
const FLAT_NAMES: [string, number][] = [
  ['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0],
];

function pitchXml(midi: number, useFlats: boolean): string {
  const [step, alter] = (useFlats ? FLAT_NAMES : SHARP_NAMES)[midi % 12]!;
  const octave = Math.floor(midi / 12) - 1;
  return `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`;
}

const TYPES: Record<number, [string, boolean]> = {
  1: ['16th', false],
  2: ['eighth', false],
  3: ['eighth', true],
  4: ['quarter', false],
  6: ['quarter', true],
  8: ['half', false],
  12: ['half', true],
  16: ['whole', false],
};

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Partwise MusicXML 4.0 for one piano part (one or two staves) with chords, rests, ties and backup. */
export function pieceToMusicXml(piece: FixturePiece): string {
  const staves = staffCount(piece);
  const flats = piece.fifths < 0;
  const measureLen = measureDivisions(piece);
  const tiedIn: Set<number>[] = Array.from({ length: staves }, () => new Set<number>());
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  out.push(
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
  );
  out.push('<score-partwise version="4.0">');
  out.push(`<work><work-title>${escapeXml(piece.title)}</work-title></work>`);
  out.push('<identification><encoding><software>OpenRoll test fixture</software></encoding></identification>');
  out.push('<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>');
  out.push('<part id="P1">');
  piece.measures.forEach((m, mi) => {
    out.push(`<measure number="${mi + 1}">`);
    if (mi === 0) {
      out.push('<attributes>');
      out.push(`<divisions>${DIVISIONS}</divisions>`);
      out.push(`<key><fifths>${piece.fifths}</fifths></key>`);
      out.push(`<time><beats>${piece.beats}</beats><beat-type>${piece.beatType}</beat-type></time>`);
      if (staves === 2) out.push('<staves>2</staves>');
      out.push(`<clef${staves === 2 ? ' number="1"' : ''}><sign>G</sign><line>2</line></clef>`);
      if (staves === 2) out.push('<clef number="2"><sign>F</sign><line>4</line></clef>');
      out.push('</attributes>');
      out.push(
        `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${piece.bpm}</per-minute></metronome></direction-type><sound tempo="${piece.bpm}"/></direction>`,
      );
    }
    for (let s = 0; s < staves; s++) {
      if (s > 0) out.push(`<backup><duration>${measureLen}</duration></backup>`);
      const events = m[s] ?? [];
      let used = 0;
      for (const e of events) {
        const [type, dot] = TYPES[e.dur] ?? (() => {
          throw new Error(`unsupported duration ${e.dur}`);
        })();
        const tail = `<voice>${s === 0 ? 1 : 5}</voice><type>${type}</type>${dot ? '<dot/>' : ''}${staves === 2 ? `<staff>${s + 1}</staff>` : ''}`;
        if (e.pitches.length === 0) {
          out.push(`<note><rest/><duration>${e.dur}</duration>${tail}</note>`);
        } else {
          const nextTied = new Set<number>();
          e.pitches.forEach((pitch, i) => {
            const stop = tiedIn[s]!.has(pitch);
            const start = !!e.tie;
            if (start) nextTied.add(pitch);
            const ties = `${stop ? '<tie type="stop"/>' : ''}${start ? '<tie type="start"/>' : ''}`;
            const tied = `${stop ? '<tied type="stop"/>' : ''}${start ? '<tied type="start"/>' : ''}`;
            out.push(
              `<note>${i > 0 ? '<chord/>' : ''}${pitchXml(pitch, flats)}<duration>${e.dur}</duration>${ties}${tail}${tied ? `<notations>${tied}</notations>` : ''}</note>`,
            );
          });
          tiedIn[s] = nextTied;
        }
        used += e.dur;
      }
      if (used !== measureLen) throw new Error(`${piece.title}: measure ${mi + 1} staff ${s + 1} has ${used}/${measureLen} divisions`);
    }
    if (mi === piece.measures.length - 1) out.push('<barline location="right"><bar-style>light-heavy</bar-style></barline>');
    out.push('</measure>');
  });
  out.push('</part>');
  out.push('</score-partwise>');
  return out.join('\n');
}

// ---------------------------------------------------------------- MXL (zip) container

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Minimal ZIP writer (store, no compression), enough for a .mxl container. */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: number[] = [];
  const central: number[] = [];
  const u16 = (a: number[], v: number) => a.push(v & 0xff, (v >>> 8) & 0xff);
  const u32 = (a: number[], v: number) => a.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const offset = chunks.length;
    u32(chunks, 0x04034b50); u16(chunks, 20); u16(chunks, 0); u16(chunks, 0); u16(chunks, 0); u16(chunks, 0x21);
    u32(chunks, crc); u32(chunks, f.data.length); u32(chunks, f.data.length); u16(chunks, name.length); u16(chunks, 0);
    chunks.push(...name, ...f.data);
    u32(central, 0x02014b50); u16(central, 20); u16(central, 20); u16(central, 0); u16(central, 0); u16(central, 0);
    u16(central, 0x21); u32(central, crc); u32(central, f.data.length); u32(central, f.data.length);
    u16(central, name.length); u16(central, 0); u16(central, 0); u16(central, 0); u16(central, 0); u32(central, 0);
    u32(central, offset); central.push(...name);
  }
  const cdOffset = chunks.length;
  const end: number[] = [];
  u32(end, 0x06054b50); u16(end, 0); u16(end, 0); u16(end, files.length); u16(end, files.length);
  u32(end, central.length); u32(end, cdOffset); u16(end, 0);
  return new Uint8Array([...chunks, ...central, ...end]);
}

/** Wrap a MusicXML string as a compressed-MusicXML (.mxl) container. */
export function musicXmlToMxl(xml: string, path = 'score.musicxml'): Uint8Array {
  const enc = new TextEncoder();
  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container><rootfiles><rootfile full-path="${path}" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;
  return zipStore([
    { name: 'mimetype', data: enc.encode('application/vnd.recordare.musicxml') },
    { name: 'META-INF/container.xml', data: enc.encode(container) },
    { name: path, data: enc.encode(xml) },
  ]);
}
