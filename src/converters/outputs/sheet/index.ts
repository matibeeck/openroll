/**
 * Sheet music: Score → MusicXML (quantized) → Verovio SVG pages, rendered in the shared Verovio
 * worker. The UI lives in src/ui/SheetView.tsx.
 */
import type { Score } from '../../../core/score';
import { scoreToMusicXml, type ScoreToMusicXmlOptions } from '../musicxml/scoreToMusicXml';
import { runVerovioJob } from '../../verovio-client';
import type { SheetRenderOptions, SheetResult } from './render';

export type { SheetRenderOptions, SheetResult } from './render';

/** Render MusicXML to page SVGs off the UI thread. A superseded call can be aborted. */
export function renderSheet(xml: string, opts: SheetRenderOptions, signal?: AbortSignal): Promise<SheetResult> {
  return runVerovioJob({ type: 'render-sheet', xml, opts }, { signal });
}

export function renderScoreSheet(
  score: Score,
  opts: SheetRenderOptions & ScoreToMusicXmlOptions,
  signal?: AbortSignal,
): Promise<SheetResult> {
  return renderSheet(scoreToMusicXml(score, opts), opts, signal);
}
