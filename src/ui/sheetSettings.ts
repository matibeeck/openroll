import type { KeySignature, Score, TimeSignature } from '../core/score';
import { isFreeTiming, type GridChoice, type QuantizeOptions } from '../core/quantize';
import { beatQuarters, estimateMeter, type MeterEstimate } from '../core/meter';

/**
 * Tempo/meter chosen in the Sheet tab; shared with the Download tab so files match what is shown.
 * For free-timing scores the tempo is in beats of the meter (dotted quarters in 6/8, 9/8, 12/8)
 * and both fields start from the estimate.
 */
export interface SheetSettings {
  bpmText: string;
  timeSig: string;
  /** Coarser grid, ornaments merged, one voice per staff. */
  simplify?: boolean;
  /** Shortest note value: 'auto', '8', '16' or '32'. */
  grid?: string;
}

export const MIN_BPM = 20;
export const MAX_BPM = 400;
export const GRID_CHOICES = ['auto', '8', '16', '32'] as const;

export function tsText(ts: TimeSignature): string {
  return `${ts.numerator}/${ts.denominator}`;
}

/** Tempo/meter estimate for a free-timing score (null when there are too few notes). */
export function sheetEstimate(score: Score, timeSig?: TimeSignature): MeterEstimate | null {
  return estimateMeter(score.notes, timeSig ? { timeSignature: timeSig } : {});
}

/** Initial settings: the tempo/meter estimate for free-timing scores, else the score's own. */
export function defaultSheetSettings(score: Score, free = isFreeTiming(score)): SheetSettings {
  const est = free ? sheetEstimate(score) : null;
  if (est) {
    return { bpmText: String(Math.round(est.beatBpm)), timeSig: tsText(est.timeSignature), simplify: false, grid: 'auto' };
  }
  return {
    bpmText: String(Math.round(score.tempos[0]?.bpm ?? 120)),
    timeSig: tsText(score.timeSignature),
    simplify: false,
    grid: 'auto',
  };
}

export function parseTimeSig(s: string): TimeSignature {
  const [n, d] = s.split('/').map(Number);
  return { numerator: n || 4, denominator: d || 4 };
}

export function parseBpm(text: string): number | undefined {
  const v = Number(text);
  return Number.isFinite(v) && v >= MIN_BPM && v <= MAX_BPM ? v : undefined;
}

function parseGrid(g: string | undefined): GridChoice {
  return g === '8' || g === '16' || g === '32' ? (Number(g) as 8 | 16 | 32) : 'auto';
}

/**
 * Settings after the user picks another meter: the tempo follows the estimate for that meter,
 * or, when the user had typed a tempo, keeps the same quarter-note speed in the new beat unit.
 */
export function withTimeSig(score: Score, s: SheetSettings, timeSig: string): SheetSettings {
  const from = parseTimeSig(s.timeSig);
  const to = parseTimeSig(timeSig);
  const oldEst = sheetEstimate(score, from);
  const user = parseBpm(s.bpmText);
  const followsEstimate = !oldEst || user === undefined || Math.round(oldEst.beatBpm) === Math.round(user);
  let bpmText = s.bpmText;
  if (followsEstimate) {
    const est = sheetEstimate(score, to);
    if (est) bpmText = String(Math.round(est.beatBpm));
  } else if (user !== undefined) {
    bpmText = String(Math.round((user * beatQuarters(from)) / beatQuarters(to)));
  }
  return { ...s, timeSig, bpmText };
}

/**
 * Quantize options for a score: user tempo/meter only apply to free-timing scores, which are
 * quantized on the tracked pulse (rubato-aware) with legato note ends. A tempo different from
 * the estimate re-tracks the pulse at that tempo.
 */
export function quantizeOptions(score: Score, free: boolean, s: SheetSettings): QuantizeOptions {
  if (!free) return {};
  const timeSignature = parseTimeSig(s.timeSig);
  const common = { timeSignature, legato: true, simplify: s.simplify ?? false, grid: parseGrid(s.grid) };
  const user = parseBpm(s.bpmText);
  const est = sheetEstimate(score, timeSignature);
  if (!est) return { ...common, bpm: user !== undefined ? user * beatQuarters(timeSignature) : undefined };
  const tracked =
    user === undefined || Math.round(user) === Math.round(est.beatBpm)
      ? est
      : estimateMeter(score.notes, { timeSignature, beatBpm: user });
  if (!tracked) return { ...common, bpm: user !== undefined ? user * beatQuarters(timeSignature) : undefined };
  const bpm = user !== undefined ? user * beatQuarters(timeSignature) : tracked.bpm;
  return { ...common, timeline: { pulses: tracked.pulses, pulseQuarters: tracked.pulseQuarters, bpm } };
}

const LETTERS = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const SOLFEGE: Record<string, string> = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };

/** Tonic name of a key, e.g. "A♭" (or "La♭" with solfège names). */
export function tonicName(key: KeySignature, solfege = false): string {
  const q = key.fifths + (key.mode === 'minor' ? 3 : 0) + 1; // F = 0 on the line of fifths
  const letter = LETTERS[((q % 7) + 7) % 7]!;
  const alter = Math.floor(q / 7);
  const acc = alter > 0 ? '♯'.repeat(alter) : '♭'.repeat(-alter);
  return `${solfege ? SOLFEGE[letter]! : letter}${acc}`;
}
