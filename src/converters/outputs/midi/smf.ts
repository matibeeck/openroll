/**
 * Minimal Standard MIDI File encoder (format 0 and 1). Pure, no dependencies.
 * Reading is done with @tonejs/midi; we write ourselves because its encoder only writes
 * format 1, floors tempo/velocity values and writes key signatures with the wrong sign.
 */

export type SmfEvent =
  | { tick: number; type: 'trackName'; text: string }
  | { tick: number; type: 'tempo'; usPerQuarter: number }
  | { tick: number; type: 'timeSignature'; numerator: number; denominator: number }
  | { tick: number; type: 'keySignature'; fifths: number; minor: boolean }
  | { tick: number; type: 'program'; channel: number; program: number }
  | { tick: number; type: 'noteOff'; channel: number; pitch: number }
  | { tick: number; type: 'noteOn'; channel: number; pitch: number; velocity: number };

export interface SmfFile {
  format: 0 | 1;
  /** Ticks per quarter note (1–32767). */
  ppq: number;
  tracks: SmfEvent[][];
}

/** Order of events that share a tick: meta first, then program, note-offs, note-ons. */
const PRIORITY: Record<SmfEvent['type'], number> = {
  trackName: 0,
  tempo: 1,
  timeSignature: 2,
  keySignature: 3,
  program: 4,
  noteOff: 5,
  noteOn: 6,
};

export function writeVarLen(value: number, out: number[]): void {
  let v = Math.max(0, Math.floor(value));
  const bytes = [v & 0x7f];
  while ((v >>= 7) > 0) bytes.unshift((v & 0x7f) | 0x80);
  out.push(...bytes);
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function u16(n: number): number[] {
  return [(n >>> 8) & 0xff, n & 0xff];
}

function clamp7(n: number): number {
  return Math.min(127, Math.max(0, Math.round(n)));
}

function metaText(type: number, text: string, out: number[]): void {
  const bytes = new TextEncoder().encode(text);
  out.push(0xff, type);
  writeVarLen(bytes.length, out);
  out.push(...bytes);
}

function encodeEvent(e: SmfEvent, out: number[]): void {
  switch (e.type) {
    case 'trackName':
      metaText(0x03, e.text, out);
      break;
    case 'tempo': {
      const us = Math.min(0xffffff, Math.max(1, Math.round(e.usPerQuarter)));
      out.push(0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff);
      break;
    }
    case 'timeSignature': {
      const dd = Math.max(0, Math.round(Math.log2(e.denominator)));
      out.push(0xff, 0x58, 0x04, e.numerator & 0xff, dd, 24, 8);
      break;
    }
    case 'keySignature': {
      const sf = Math.max(-7, Math.min(7, Math.round(e.fifths)));
      out.push(0xff, 0x59, 0x02, sf & 0xff, e.minor ? 1 : 0);
      break;
    }
    case 'program':
      out.push(0xc0 | (e.channel & 0x0f), clamp7(e.program));
      break;
    case 'noteOff':
      out.push(0x80 | (e.channel & 0x0f), clamp7(e.pitch), 0x40);
      break;
    case 'noteOn':
      out.push(0x90 | (e.channel & 0x0f), clamp7(e.pitch), Math.max(1, clamp7(e.velocity)));
      break;
  }
}

export function encodeTrack(events: SmfEvent[]): number[] {
  const sorted = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.tick - b.e.tick || PRIORITY[a.e.type] - PRIORITY[b.e.type] || a.i - b.i)
    .map((x) => x.e);
  const body: number[] = [];
  let last = 0;
  for (const e of sorted) {
    const tick = Math.max(last, Math.round(e.tick));
    writeVarLen(tick - last, body);
    last = tick;
    encodeEvent(e, body);
  }
  body.push(0x00, 0xff, 0x2f, 0x00); // end of track
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body];
}

export function encodeSmf(file: SmfFile): Uint8Array {
  if (file.format === 0 && file.tracks.length !== 1) {
    throw new Error('SMF format 0 needs exactly one track');
  }
  const out: number[] = [0x4d, 0x54, 0x68, 0x64, ...u32(6), ...u16(file.format), ...u16(file.tracks.length), ...u16(file.ppq)];
  for (const t of file.tracks) {
    // Push in chunks: spreading a huge array into push() can overflow the call stack.
    const bytes = encodeTrack(t);
    for (let i = 0; i < bytes.length; i += 8192) out.push(...bytes.slice(i, i + 8192));
  }
  return new Uint8Array(out);
}
