/**
 * Score → two-staff piano MusicXML 4.0 (partwise). Pure: quantize, lay out voices, then print.
 * Staff 1 (treble) = right hand, staff 2 (bass) = left hand; notes without a hand go by pitch.
 */
import { quantize, type QuantizeOptions, type QuantizedScore } from '../../../core/quantize';
import type { KeySignature, Score } from '../../../core/score';
import { assignVoices, beatTicks, buildChords, voicePieces, type Piece } from './layout';

export interface ScoreToMusicXmlOptions extends QuantizeOptions {
  /** Maximum voices per staff. Default 2. */
  maxVoices?: number;
}

// ---------------------------------------------------------------- pitch spelling

const SHARP_SPELL: [string, number][] = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
];
const FLAT_SPELL: [string, number][] = [
  ['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0],
];
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const STEP_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export interface Spelled {
  step: string;
  alter: number;
  octave: number;
}

/** Spell a MIDI pitch for a key: sharps in sharp keys and C, flats in flat keys; key notes use the key's spelling. */
export function spell(pitch: number, key: KeySignature): Spelled {
  const pc = ((pitch % 12) + 12) % 12;
  const keyAlter = keyAlterations(key);
  // Prefer the spelling that the key signature already provides (e.g. Cb in Gb major, E# in C# major).
  for (const [step, alter] of Object.entries(keyAlter)) {
    if (((STEP_PC[step]! + alter + 12) % 12) === pc) {
      const octave = Math.floor((pitch - alter) / 12) - 1;
      return { step, alter, octave };
    }
  }
  const [step, alter] = (key.fifths < 0 ? FLAT_SPELL : SHARP_SPELL)[pc]!;
  return { step, alter, octave: Math.floor(pitch / 12) - 1 };
}

/** Steps altered by a key signature: step → alter. */
export function keyAlterations(key: KeySignature): Record<string, number> {
  const out: Record<string, number> = {};
  const n = Math.min(7, Math.abs(key.fifths));
  for (let i = 0; i < n; i++) {
    if (key.fifths > 0) out[SHARP_ORDER[i]!] = 1;
    else out[SHARP_ORDER[6 - i]!] = -1;
  }
  return out;
}

const ACCIDENTAL_NAME: Record<number, string> = { [-2]: 'flat-flat', [-1]: 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' };

// ---------------------------------------------------------------- XML helpers

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtBpm(bpm: number): string {
  return String(Math.round(bpm * 100) / 100);
}

function tempoDirection(bpm: number): string {
  const shown = Math.round(bpm);
  return (
    `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>` +
    `<per-minute>${shown}</per-minute></metronome></direction-type><staff>1</staff><sound tempo="${fmtBpm(bpm)}"/></direction>`
  );
}

interface Stream {
  staff: 1 | 2;
  voice: number;
  pieces: Piece[];
}

/** Lay out a quantized score into per-staff, per-voice piece streams. */
export function layoutStreams(q: QuantizedScore, maxVoices = 2): { streams: Stream[]; totalTicks: number } {
  const lastEnd = q.notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
  const totalTicks = Math.max(1, Math.ceil(lastEnd / q.measureTicks)) * q.measureTicks;
  const tempoSplits = q.tempos.map((t) => t.tick).filter((t) => t > 0 && t < totalTicks);
  const streams: Stream[] = [];
  for (const staff of [1, 2] as const) {
    const hand = staff === 1 ? 'R' : 'L';
    const voices = assignVoices(
      buildChords(q.notes.filter((n) => n.hand === hand)),
      maxVoices,
    );
    if (voices.length === 0) voices.push([]);
    voices.forEach((chords, i) => {
      streams.push({
        staff,
        voice: (staff - 1) * 4 + i + 1,
        pieces: voicePieces(chords, {
          totalTicks,
          measureTicks: q.measureTicks,
          divisions: q.divisions,
          timeSignature: q.timeSignature,
          primary: i === 0,
          extraSplits: staff === 1 && i === 0 ? tempoSplits : [],
        }),
      });
    });
  }
  return { streams, totalTicks };
}

/** Decide which notes print an accidental: per staff and measure, in time order, against the key. */
function accidentals(streams: Stream[], q: QuantizedScore): Map<Piece, Map<number, number | null>> {
  const result = new Map<Piece, Map<number, number | null>>();
  const keyAlter = keyAlterations(q.key);
  for (const staff of [1, 2]) {
    const pieces = streams.filter((s) => s.staff === staff).flatMap((s) => s.pieces.filter((p) => p.kind === 'chord'));
    pieces.sort((a, b) => a.start - b.start);
    let measure = -1;
    let state = new Map<string, number>();
    for (const p of pieces) {
      const m = Math.floor(p.start / q.measureTicks);
      if (m !== measure) {
        measure = m;
        state = new Map();
      }
      const marks = new Map<number, number | null>();
      for (const pitch of p.pitches) {
        const s = spell(pitch, q.key);
        const id = `${s.step}${s.octave}`;
        const current = state.get(id) ?? keyAlter[s.step] ?? 0;
        if (p.tieStop) {
          marks.set(pitch, null);
          continue;
        }
        marks.set(pitch, current === s.alter ? null : s.alter);
        state.set(id, s.alter);
      }
      result.set(p, marks);
    }
  }
  return result;
}

/** Beam markup per chord piece of one measure of one voice. */
function beams(pieces: Piece[], measureStart: number, beat: number): Map<Piece, string[]> {
  const out = new Map<Piece, string[]>();
  let group: Piece[] = [];
  const flush = () => {
    if (group.length >= 2) {
      const maxLevel = Math.max(...group.map((p) => p.value!.beams));
      group.forEach((p, i) => {
        const tags: string[] = [];
        for (let level = 1; level <= maxLevel; level++) {
          const has = (k: number) => (group[k]?.value?.beams ?? 0) >= level;
          if (!has(i)) continue;
          const prev = i > 0 && has(i - 1);
          const next = i < group.length - 1 && has(i + 1);
          const kind = prev && next ? 'continue' : next ? 'begin' : prev ? 'end' : i === 0 ? 'forward hook' : 'backward hook';
          tags.push(`<beam number="${level}">${kind}</beam>`);
        }
        out.set(p, tags);
      });
    }
    group = [];
  };
  let groupBeat = -1;
  for (const p of pieces) {
    const b = Math.floor((p.start - measureStart) / beat);
    const beamable = p.kind === 'chord' && (p.value?.beams ?? 0) > 0;
    if (!beamable || b !== groupBeat) flush();
    if (beamable) {
      group.push(p);
      groupBeat = b;
    } else {
      groupBeat = -1;
    }
  }
  flush();
  return out;
}

function noteXml(p: Piece, staff: number, voice: number, acc: Map<number, number | null> | undefined, beamTags: string[] | undefined, q: QuantizedScore): string[] {
  const value = p.value;
  const typeXml = value ? `<type>${value.type}</type>${value.dots ? '<dot/>' : ''}` : '';
  if (p.kind === 'rest') {
    const rest = p.measureRest ? '<rest measure="yes"/>' : '<rest/>';
    return [`<note>${rest}<duration>${p.duration}</duration><voice>${voice}</voice>${typeXml}<staff>${staff}</staff></note>`];
  }
  return p.pitches
    .slice()
    .reverse() // top note first reads naturally; order does not matter for MusicXML
    .map((pitch, i) => {
      const s = spell(pitch, q.key);
      const alterXml = s.alter ? `<alter>${s.alter}</alter>` : '';
      const ties = `${p.tieStop ? '<tie type="stop"/>' : ''}${p.tieStart ? '<tie type="start"/>' : ''}`;
      const mark = acc?.get(pitch);
      const accXml = mark === null || mark === undefined ? '' : `<accidental>${ACCIDENTAL_NAME[mark]}</accidental>`;
      const beamXml = i === 0 && beamTags ? beamTags.join('') : '';
      const tied = `${p.tieStop ? '<tied type="stop"/>' : ''}${p.tieStart ? '<tied type="start"/>' : ''}`;
      return (
        `<note>${i > 0 ? '<chord/>' : ''}<pitch><step>${s.step}</step>${alterXml}<octave>${s.octave}</octave></pitch>` +
        `<duration>${p.duration}</duration>${ties}<voice>${voice}</voice>${typeXml}${accXml}<staff>${staff}</staff>${beamXml}` +
        `${tied ? `<notations>${tied}</notations>` : ''}</note>`
      );
    });
}

/** Write a quantized score as MusicXML. */
export function quantizedToMusicXml(q: QuantizedScore, maxVoices = 2): string {
  const { streams, totalTicks } = layoutStreams(q, maxVoices);
  const acc = accidentals(streams, q);
  const beat = beatTicks(q.timeSignature, q.divisions);
  const measures = totalTicks / q.measureTicks;
  const tempoAt = new Map(q.tempos.map((t) => [t.tick, t.bpm]));

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  out.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  out.push('<score-partwise version="4.0">');
  out.push(`<work><work-title>${esc(q.title || 'Untitled')}</work-title></work>`);
  out.push(`<movement-title>${esc(q.title || 'Untitled')}</movement-title>`);
  out.push('<identification><encoding><software>OpenRoll</software></encoding></identification>');
  out.push('<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>');
  out.push('<part id="P1">');
  for (let m = 0; m < measures; m++) {
    const mStart = m * q.measureTicks;
    const mEnd = mStart + q.measureTicks;
    out.push(`<measure number="${m + 1}">`);
    if (m === 0) {
      out.push(
        `<attributes><divisions>${q.divisions}</divisions><key><fifths>${q.key.fifths}</fifths><mode>${q.key.mode}</mode></key>` +
          `<time><beats>${q.timeSignature.numerator}</beats><beat-type>${q.timeSignature.denominator}</beat-type></time>` +
          '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>',
      );
    }
    streams.forEach((stream, si) => {
      if (si > 0) out.push(`<backup><duration>${q.measureTicks}</duration></backup>`);
      const inMeasure = stream.pieces.filter((p) => p.start >= mStart && p.start < mEnd);
      const beamMap = beams(inMeasure, mStart, beat);
      for (const p of inMeasure) {
        if (si === 0) {
          const bpm = tempoAt.get(p.start);
          if (bpm !== undefined) out.push(tempoDirection(bpm));
        }
        if (p.kind === 'forward') {
          out.push(`<forward><duration>${p.duration}</duration><voice>${stream.voice}</voice><staff>${stream.staff}</staff></forward>`);
          continue;
        }
        out.push(...noteXml(p, stream.staff, stream.voice, acc.get(p), beamMap.get(p), q));
      }
    });
    if (m === measures - 1) out.push('<barline location="right"><bar-style>light-heavy</bar-style></barline>');
    out.push('</measure>');
  }
  out.push('</part>');
  out.push('</score-partwise>');
  return out.join('\n');
}

/** Score → MusicXML 4.0 string (two-staff piano). */
export function scoreToMusicXml(score: Score, opts: ScoreToMusicXmlOptions = {}): string {
  return quantizedToMusicXml(quantize(score, opts), opts.maxVoices ?? 2);
}
