/**
 * Key estimation (src/core/key.ts) on fixtures written in code: the Ballade No. 3 theme
 * (A♭ major, 6/8), F major over a C pedal (two shapes, one like the real recording), and classic
 * cases. Every piece is also tried in all 12 transpositions, played (rubato, jitter, early
 * releases) and as written. Prints a confusion summary and the margins.
 */
import { describe, expect, it } from 'vitest';
import { ALL_KEYS, analyzeKey, bassNotes, findPedal, keyOf, tonicOf, type KeyAnalysis } from '../../src/core/key';
import type { KeySignature, Note, Score } from '../../src/core/score';
import { tonicName } from '../../src/ui/sheetSettings';
import { balladeTheme, fMajorOverPedal, performed } from '../fixtures/ballade';
import { aMinorLeadingTone, aMinorPicardy, cMajorCadence, dMajorOverAPedal, fMajorPedalExcerpt } from '../fixtures/keys';
import { minuetInG, pieceToScore, type FixturePiece } from '../fixtures/music';
import { report } from '../roundtrip/metrics';

const name = (k: KeySignature) => `${tonicName(k)} ${k.mode}`;
const notesOf = (s: Score): Note[] => s.notes;

interface Case {
  piece: FixturePiece;
  key: KeySignature;
  /** Smallest margin (score of the best key minus the second) required in every version. */
  minMargin: number;
}

const CASES: Case[] = [
  { piece: balladeTheme, key: { fifths: -4, mode: 'major' }, minMargin: 0.2 },
  { piece: fMajorOverPedal, key: { fifths: -1, mode: 'major' }, minMargin: 0.2 },
  { piece: fMajorPedalExcerpt, key: { fifths: -1, mode: 'major' }, minMargin: 0.1 },
  { piece: cMajorCadence, key: { fifths: 0, mode: 'major' }, minMargin: 0.2 },
  { piece: aMinorLeadingTone, key: { fifths: 0, mode: 'minor' }, minMargin: 0.2 },
  { piece: dMajorOverAPedal, key: { fifths: 2, mode: 'major' }, minMargin: 0.2 },
  { piece: minuetInG, key: { fifths: 1, mode: 'major' }, minMargin: 0.1 },
  // Documented: a Picardy third only nudges the final-chord evidence; the piece stays minor.
  { piece: aMinorPicardy, key: { fifths: 0, mode: 'minor' }, minMargin: 0.02 },
];

function transpose(notes: Note[], semitones: number): Note[] {
  // Keep the register: shift down when going up more than a tritone.
  const shift = semitones > 6 ? semitones - 12 : semitones;
  return notes.map((n) => ({ ...n, pitch: n.pitch + shift }));
}

function transposedKey(key: KeySignature, semitones: number): KeySignature {
  return keyOf(tonicOf(key) + semitones, key.mode);
}

/** How a wrong answer relates to the right key. */
function relation(got: KeySignature, want: KeySignature): string {
  const g = tonicOf(got);
  const w = tonicOf(want);
  if (g === w && got.mode === want.mode) return 'correct';
  if (got.fifths === want.fifths) return 'relative';
  if (g === w) return 'parallel';
  if (got.mode === want.mode && ((g - w + 12) % 12 === 7 || (g - w + 12) % 12 === 5)) return 'fifth';
  return 'other';
}

describe('key estimation on fixtures', () => {
  it('finds the written key, in all 12 transpositions, played and as written', () => {
    const lines: string[] = [];
    const confusion: Record<string, number> = { correct: 0, relative: 0, parallel: 0, fifth: 0, other: 0 };
    // Baseline: profile correlation alone (notes without times: no bass, final chord or pedal).
    const baseline: Record<string, number> = { correct: 0, relative: 0, parallel: 0, fifth: 0, other: 0 };
    const failures: string[] = [];
    for (const c of CASES) {
      const versions: [string, Note[]][] = [
        ['written', notesOf(pieceToScore(c.piece))],
        ['played', notesOf(performed(c.piece))],
      ];
      let minMargin = Infinity;
      let original: KeyAnalysis | null = null;
      for (const [label, notes] of versions) {
        for (let t = 0; t < 12; t++) {
          const want = transposedKey(c.key, t);
          const moved = transpose(notes, t);
          const a = analyzeKey(moved);
          const rel = relation(a.key, want);
          baseline[relation(analyzeKey(moved.map((n) => ({ pitch: n.pitch, duration: n.duration }))).key, want)]!++;
          confusion[rel]!++;
          if (rel !== 'correct') failures.push(`${c.piece.title} (${label}, +${t}): ${name(a.key)} instead of ${name(want)}`);
          else minMargin = Math.min(minMargin, a.margin);
          if (t === 0 && label === 'played') original = a;
        }
      }
      const a = original!;
      lines.push(
        `  ${c.piece.title.padEnd(40)} want ${name(c.key).padEnd(9)} got ${name(a.key).padEnd(9)} ` +
          `margin ${a.margin.toFixed(3)} (min over versions ${minMargin.toFixed(3)}), 2nd ${name(a.candidates[1]!.key)}, ` +
          `r ${a.candidates[0]!.correlation.toFixed(3)} vs ${a.candidates[1]!.correlation.toFixed(3)}${a.pedal !== null ? `, pedal ${tonicName(keyOf(a.pedal, 'major'))}` : ''}`,
      );
      expect(minMargin, c.piece.title).toBeGreaterThanOrEqual(c.minMargin);
    }
    const total = Object.values(confusion).reduce((s, x) => s + x, 0);
    report(`[key] ${CASES.length} pieces × 12 transpositions × 2 versions = ${total} runs`);
    for (const l of lines) report(`[key]${l}`);
    const fmt = (c: Record<string, number>) => Object.entries(c).map(([k, v]) => `${k} ${v}`).join(', ');
    report(`[key] confusion:          ${fmt(confusion)}`);
    report(`[key] profile only (base): ${fmt(baseline)}`);
    for (const f of failures) report(`[key]   wrong: ${f}`);
    expect(failures).toEqual([]);
  });

  it('a dominant pedal does not become the tonic; without the pedal logic it would', () => {
    const notes = notesOf(performed(fMajorPedalExcerpt));
    const a = analyzeKey(notes);
    expect(a.pedal).toBe(0); // C
    expect(a.key).toEqual({ fifths: -1, mode: 'major' });
    // Plain correlation over the whole histogram ranks C major first (tonic C, dominant G).
    const full = analyzeKey(notes.map((n) => ({ pitch: n.pitch, duration: n.duration }))); // no times: no bass, no pedal
    expect(full.key).toEqual({ fifths: 0, mode: 'major' });
  });
});

describe('key helpers', () => {
  it('lists the 24 keys once, with conventional signatures', () => {
    expect(ALL_KEYS).toHaveLength(24);
    expect(new Set(ALL_KEYS.map((k) => `${k.fifths}${k.mode}`)).size).toBe(24);
    for (const k of ALL_KEYS) expect(keyOf(tonicOf(k), k.mode)).toEqual(k);
    expect(keyOf(8, 'major')).toEqual({ fifths: -4, mode: 'major' }); // A♭
    expect(keyOf(9, 'minor')).toEqual({ fifths: 0, mode: 'minor' }); // A minor
    expect(keyOf(5, 'minor')).toEqual({ fifths: -4, mode: 'minor' }); // F minor
    expect(tonicOf({ fifths: 2, mode: 'minor' })).toBe(11); // B minor
  });

  it('bass = the lowest voice: chord tones above a bass note are not bass', () => {
    const n = (pitch: number, start: number, duration: number) => ({ pitch, start, duration });
    const bass = bassNotes([
      n(36, 0, 0.3), // C2
      n(52, 0.33, 0.3), // E3 off-beat: C2 struck 0.33 s before
      n(55, 0.33, 0.3), // G3
      n(53, 1.0, 0.3), // F3: nothing lower near it
      n(55, 1.4, 0.3), // G3: F3 0.4 s before
      n(72, 2.0, 0.5), // C5: above middle C, never bass
    ]);
    expect(bass.map((x) => x.pitch)).toEqual([36, 53]);
  });

  it('a pedal needs half the bass and a long repeated run (its fifth may alternate)', () => {
    const share = (pc: number, w: number) => Object.assign(new Array<number>(12).fill(0), { [pc]: w, [(pc + 5) % 12]: 1 - w });
    expect(findPedal([0, 7, 0, 7, 0, 7, 5], share(0, 0.6))).toBe(0);
    expect(findPedal([0, 7, 0, 5, 0, 7, 0], share(0, 0.6))).toBeNull(); // run broken
    expect(findPedal([0, 0, 0, 0, 0, 0], share(0, 0.4))).toBeNull(); // not half the bass
    expect(findPedal([], new Array<number>(12).fill(0))).toBeNull();
  });

  it('no notes: C major, no margin', () => {
    const a = analyzeKey([]);
    expect(a.key).toEqual({ fifths: 0, mode: 'major' });
    expect(a.margin).toBe(0);
  });
});
