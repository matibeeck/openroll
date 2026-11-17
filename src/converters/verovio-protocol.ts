import type { Score } from '../core/score';
import type { MusicXmlToScoreOptions } from './inputs/musicxml/xml';
import type { SheetRenderOptions, SheetResult } from './outputs/sheet/render';

/** Messages to the shared Verovio worker (MusicXML import + sheet rendering use ONE Verovio chunk). */
export type VerovioJob =
  | { type: 'musicxml-to-score'; bytes: Uint8Array; title?: string; opts: MusicXmlToScoreOptions }
  | { type: 'render-sheet'; xml: string; opts: SheetRenderOptions };

export interface VerovioJobResult {
  'musicxml-to-score': Score;
  'render-sheet': SheetResult;
}

export type VerovioRequest = VerovioJob & { id: number };

export type VerovioResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
