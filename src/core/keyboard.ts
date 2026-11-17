/** Piano keyboard geometry shared by the practice renderer, video export and video recognition. */
const BLACK_PCS = new Set([1, 3, 6, 8, 10]);

export function isBlack(pitch: number): boolean {
  return BLACK_PCS.has(((pitch % 12) + 12) % 12);
}

export interface KeyRect {
  pitch: number;
  black: boolean;
  /** Left edge in px. */
  x: number;
  width: number;
}

export interface KeyboardLayout {
  keys: KeyRect[];
  /** Lookup by pitch. */
  byPitch: Map<number, KeyRect>;
  whiteWidth: number;
  low: number;
  high: number;
}

/** Offsets (in white-key widths) of black keys relative to the left edge of the white key below them. */
const BLACK_OFFSET: Record<number, number> = { 1: 0.6, 3: 0.75, 6: 0.55, 8: 0.65, 10: 0.75 };
export const BLACK_WIDTH_RATIO = 0.6;

export function countWhite(low: number, high: number): number {
  let n = 0;
  for (let p = low; p <= high; p++) if (!isBlack(p)) n++;
  return n;
}

/** Lays out keys from `low` to `high` (inclusive) across `width` px starting at `x0`. */
export function layoutKeyboard(width: number, low = 21, high = 108, x0 = 0): KeyboardLayout {
  const whites = countWhite(low, high);
  const ww = width / whites;
  const keys: KeyRect[] = [];
  let wi = 0;
  for (let p = low; p <= high; p++) {
    if (!isBlack(p)) {
      keys.push({ pitch: p, black: false, x: x0 + wi * ww, width: ww });
      wi++;
    } else {
      const pc = ((p % 12) + 12) % 12;
      const off = BLACK_OFFSET[pc] ?? 0.65;
      // Left edge of the previous white key is (wi - 1) * ww.
      keys.push({ pitch: p, black: true, x: x0 + (wi - 1 + off) * ww, width: ww * BLACK_WIDTH_RATIO });
    }
  }
  return { keys, byPitch: new Map(keys.map((k) => [k.pitch, k])), whiteWidth: ww, low, high };
}

const LETTERS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SOLFEGE = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];

export type LabelStyle = 'letters' | 'solfege';

export function noteName(pitch: number, style: LabelStyle = 'letters', withOctave = false): string {
  const pc = ((pitch % 12) + 12) % 12;
  const name = (style === 'solfege' ? SOLFEGE : LETTERS)[pc]!;
  return withOctave ? `${name}${Math.floor(pitch / 12) - 1}` : name;
}
