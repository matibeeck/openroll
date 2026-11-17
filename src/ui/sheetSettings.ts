import type { Score, TimeSignature } from '../core/score';
import type { QuantizeOptions } from '../core/quantize';

/** Tempo/meter chosen in the Sheet tab; shared with the Download tab so files match what is shown. */
export interface SheetSettings {
  bpmText: string;
  timeSig: string;
}

export const MIN_BPM = 20;
export const MAX_BPM = 400;

export function defaultSheetSettings(score: Score): SheetSettings {
  return {
    bpmText: String(Math.round(score.tempos[0]?.bpm ?? 120)),
    timeSig: `${score.timeSignature.numerator}/${score.timeSignature.denominator}`,
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

/** Quantize options for a score: user tempo/meter only apply to free-timing scores. */
export function quantizeOptions(free: boolean, s: SheetSettings): QuantizeOptions {
  return free ? { bpm: parseBpm(s.bpmText), timeSignature: parseTimeSig(s.timeSig) } : {};
}
