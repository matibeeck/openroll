/// <reference lib="webworker" />
/**
 * Runs MusicXML/MXL → Score (Verovio WASM) off the UI thread. Verovio is loaded lazily by
 * src/core/verovio.ts on the first request and kept for later ones.
 */
import { musicXmlToScore } from './musicxmlToScore';
import type { MusicXmlRequest, MusicXmlResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (e: MessageEvent<MusicXmlRequest>) => {
  const { id, bytes, title, opts } = e.data;
  let reply: MusicXmlResponse;
  try {
    reply = { id, ok: true, score: await musicXmlToScore(bytes, title, opts) };
  } catch (err) {
    reply = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  scope.postMessage(reply);
};
