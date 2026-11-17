/// <reference lib="webworker" />
/**
 * The one Verovio worker: MusicXML/MXL → Score and MusicXML → page SVGs, off the UI thread.
 * Verovio is loaded lazily by src/core/verovio.ts on the first job and kept warm.
 * Both jobs live in this single worker because every worker is bundled separately: two workers
 * would ship two copies of the 8 MB Verovio module.
 */
import { withVerovio } from '../core/verovio';
import { musicXmlToScore } from './inputs/musicxml/musicxmlToScore';
import { renderSheetWith } from './outputs/sheet/render';
import type { VerovioRequest, VerovioResponse } from './verovio-protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

async function run(req: VerovioRequest): Promise<unknown> {
  switch (req.type) {
    case 'musicxml-to-score':
      return musicXmlToScore(req.bytes, req.title, req.opts);
    case 'render-sheet':
      return withVerovio((tk) => renderSheetWith(tk, req.xml, req.opts));
  }
}

scope.onmessage = async (e: MessageEvent<VerovioRequest>) => {
  const { id } = e.data;
  let reply: VerovioResponse;
  try {
    reply = { id, ok: true, result: await run(e.data) };
  } catch (err) {
    reply = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  scope.postMessage(reply);
};
