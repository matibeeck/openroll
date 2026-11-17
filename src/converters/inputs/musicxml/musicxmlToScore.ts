import type { Hand, Score, TrackInfo } from '../../../core/score';
import { base64ToBytes, withVerovio } from '../../../core/verovio';
import { midiBytesToScore } from '../midi/midiToScore';
import { decodeXml, isZip, MusicXmlParseError, type MusicXmlToScoreOptions } from './xml';

export { decodeXml, isZip, MusicXmlParseError, type MusicXmlToScoreOptions } from './xml';

export interface StaffInfo {
  /** MEI staff number. */
  n: number;
  /** Part (staff group) label, or the staff's own label. */
  label: string;
  /** Hand implied by the staff layout: staff 1/2 of a two-staff part → R/L. */
  hand: Hand | undefined;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .trim();
}

/** Title from the MEI header that Verovio generates (work title / movement title). */
export function titleFromMei(mei: string): string {
  const stmt = /<titleStmt\b[^>]*>([\s\S]*?)<\/titleStmt>/.exec(mei)?.[1] ?? '';
  const titles = [...stmt.matchAll(/<title\b[^>]*>([^<]*)<\/title>/g)].map((m) => unescapeXml(m[1] ?? ''));
  return titles.find((t) => t.length > 0) ?? '';
}

/**
 * Staves of the first scoreDef in document order (the order of Verovio's MIDI tracks).
 * A part with exactly two staves is a nested staffGrp in MEI: its first staff is the right hand,
 * its second the left hand.
 */
export function parseStaffLayout(mei: string): StaffInfo[] {
  const start = mei.indexOf('<scoreDef');
  const end = mei.indexOf('</scoreDef>', start);
  if (start < 0 || end < 0) return [];
  const def = mei.slice(start, end);

  interface Group {
    label: string;
    depth: number;
    staves: { n: number; label: string }[];
  }
  const stack: Group[] = [];
  const all: { n: number; label: string; group: Group | undefined }[] = [];
  let current: { n: number; label: string } | null = null;
  const re = /<staffGrp\b([^>]*?)(\/?)>|<\/staffGrp>|<staffDef\b([^>]*?)(\/?)>|<\/staffDef>|<label\b[^>]*>([^<]*)<\/label>/g;
  for (const m of def.matchAll(re)) {
    const tag = m[0];
    if (tag.startsWith('<staffGrp')) {
      if (m[2] !== '/') stack.push({ label: '', depth: stack.length + 1, staves: [] });
    } else if (tag === '</staffGrp>') {
      stack.pop();
    } else if (tag.startsWith('<staffDef')) {
      const n = Number(/\bn="(\d+)"/.exec(m[3] ?? '')?.[1] ?? all.length + 1);
      const staff = { n, label: '' };
      const group = stack[stack.length - 1];
      group?.staves.push(staff);
      all.push({ ...staff, group });
      // Keep a live reference so a nested <label> updates the entry we pushed.
      current = m[4] === '/' ? null : all[all.length - 1]!;
    } else if (tag === '</staffDef>') {
      current = null;
    } else {
      const text = unescapeXml(m[5] ?? '');
      if (current) current.label = text;
      else if (stack.length > 0) stack[stack.length - 1]!.label = text;
    }
  }
  return all.map((s) => {
    const g = s.group;
    const pair = g && g.depth >= 2 && g.staves.length === 2;
    const idx = g ? g.staves.findIndex((x) => x.n === s.n) : -1;
    return {
      n: s.n,
      label: s.label || g?.label || '',
      hand: pair ? (idx === 0 ? 'R' : 'L') : undefined,
    };
  });
}

function trackInfoFor(staff: StaffInfo | undefined, fallbackName: string): TrackInfo {
  if (!staff) return { name: fallbackName };
  const base = staff.label || fallbackName;
  if (staff.hand === 'R') return { name: `${base} - Right hand`, hand: 'R' };
  if (staff.hand === 'L') return { name: `${base} - Left hand`, hand: 'L' };
  return { name: base };
}

/**
 * MusicXML (text, bytes) or MXL (zip bytes) → Score, via Verovio: MusicXML → MIDI → Score.
 * Staves 1/2 of a two-staff part become right/left hand; anything else falls back to track
 * names, then to a pitch split.
 */
export async function musicXmlToScore(
  input: string | Uint8Array,
  title?: string,
  opts: MusicXmlToScoreOptions = {},
): Promise<Score> {
  return withVerovio((tk) => {
    let ok: boolean;
    if (typeof input !== 'string' && isZip(input)) {
      ok = tk.loadZipDataBuffer(input.slice().buffer);
    } else {
      const text = typeof input === 'string' ? input : decodeXml(input);
      if (!/<score-(partwise|timewise)\b/.test(text)) throw new MusicXmlParseError('Not a MusicXML file');
      ok = tk.loadData(text);
    }
    if (!ok) throw new MusicXmlParseError(`Verovio could not read the file${tk.getLog() ? `: ${tk.getLog()}` : ''}`);

    const midiB64 = tk.renderToMIDI();
    if (!midiB64) throw new MusicXmlParseError('Verovio produced no MIDI');
    const mei = tk.getMEI();
    const staves = parseStaffLayout(mei);
    const embeddedTitle = titleFromMei(mei);

    const score = midiBytesToScore(base64ToBytes(midiB64), undefined, {
      splitPitch: opts.splitPitch,
      durationPadTicks: 1,
      trackInfo: (i, name) => trackInfoFor(staves[i], name),
    });
    return { ...score, title: embeddedTitle || title?.trim() || 'Untitled' };
  });
}
