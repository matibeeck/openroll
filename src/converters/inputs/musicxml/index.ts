import type { Score } from '../../../core/score';
import type { InputConverter, ProgressFn } from '../../types';
import { titleFromFileName } from '../midi';
// Only light, Verovio-free helpers are imported here. The conversion itself (musicXmlToScore)
// runs in the worker; importing it on this side would make the bundler emit a second copy of the
// 8 MB Verovio chunk for the main thread. Tests import musicxmlToScore.ts directly.
import { decodeXml, isZip, MusicXmlParseError, type MusicXmlToScoreOptions } from './xml';
import type { MusicXmlRequest, MusicXmlResponse } from './protocol';

export { MusicXmlParseError, type MusicXmlToScoreOptions } from './xml';

function abortError(): DOMException {
  return new DOMException('Conversion cancelled', 'AbortError');
}

// One long-lived worker keeps Verovio warm between imports; it is recreated after a cancel.
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (s: Score) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./musicxml.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<MusicXmlResponse>) => {
    const job = pending.get(e.data.id);
    if (!job) return;
    pending.delete(e.data.id);
    if (e.data.ok) job.resolve(e.data.score);
    else job.reject(new MusicXmlParseError(e.data.error));
  };
  w.onerror = (e) => {
    for (const job of pending.values()) job.reject(new Error(e.message || 'MusicXML worker failed'));
    pending.clear();
    w.terminate();
    if (worker === w) worker = null;
  };
  worker = w;
  return w;
}

function convertInWorker(bytes: Uint8Array, title: string, opts: MusicXmlToScoreOptions, signal: AbortSignal): Promise<Score> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<Score>((resolve, reject) => {
    const onAbort = () => {
      pending.delete(id);
      // Verovio calls are synchronous inside the worker: the only way to stop one is to kill it.
      w.terminate();
      if (worker === w) {
        worker = null;
        for (const job of pending.values()) job.reject(abortError());
        pending.clear();
      }
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    pending.set(id, {
      resolve: (s) => {
        signal.removeEventListener('abort', onAbort);
        resolve(s);
      },
      reject: (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    });
    const msg: MusicXmlRequest = { id, bytes, title, opts };
    w.postMessage(msg, [bytes.buffer]);
  });
}

export const musicXmlInput: InputConverter<MusicXmlToScoreOptions> = {
  id: 'musicxml',
  label: 'MusicXML',
  accepts: {
    extensions: ['.musicxml', '.mxl', '.xml'],
    mimeTypes: [
      'application/vnd.recordare.musicxml+xml',
      'application/vnd.recordare.musicxml',
      'application/xml',
      'text/xml',
    ],
  },
  /** True for an MXL container or XML whose root is score-partwise / score-timewise. */
  async sniff(file: File): Promise<boolean> {
    const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    if (isZip(head)) return /\.mxl$/i.test(file.name) || /META-INF\/container\.xml/.test(new TextDecoder('latin1').decode(head));
    return /<score-(partwise|timewise)\b/.test(decodeXml(head));
  },
  async convert(file: File, opts: MusicXmlToScoreOptions, onProgress: ProgressFn, signal: AbortSignal): Promise<Score> {
    if (signal.aborted) throw abortError();
    onProgress(0, 'reading');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (signal.aborted) throw abortError();
    onProgress(0.2, 'engraving');
    const title = titleFromFileName(file.name);
    if (typeof Worker === 'undefined') throw new MusicXmlParseError('This browser cannot run Web Workers');
    const score = await convertInWorker(bytes, title, opts, signal);
    if (signal.aborted) throw abortError();
    onProgress(1);
    return score;
  },
};
