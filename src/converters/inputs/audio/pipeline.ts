/**
 * Shared audio / performance-video pipeline (browser only):
 * decode + resample (main thread, native) → Basic Pitch (Web Worker) → post-process (pure) → Score.
 */
import type { Score } from '../../../core/score';
import type { ProgressFn } from '../../types';
import { decodeToMono22k } from './decode';
import { postprocess, type PostprocessOptions, type RawNoteEvent } from './postprocess';
import type { BasicPitchRequest, BasicPitchResponse } from './protocol';

export interface AudioConvertOptions {
  /** Overrides for the post-processing defaults (min length, merge gap, hand split…). */
  postprocess?: Partial<PostprocessOptions>;
}

const DECODE_END = 0.1;
const INFER_END = 0.97;

function abortError(): DOMException {
  return new DOMException('Conversion cancelled', 'AbortError');
}

export function titleFromFileName(name: string): string {
  return name.replace(/\.[^./\\]+$/, '').trim() || 'Transcription';
}

export function modelUrl(): string {
  const base = typeof document !== 'undefined' ? document.baseURI : self.location.href;
  return new URL(`${import.meta.env.BASE_URL}models/basic-pitch/model.json`, base).href;
}

/** Runs Basic Pitch in a fresh worker; the worker is always terminated afterwards. */
export function transcribeInWorker(
  audio: Float32Array,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<RawNoteEvent[]> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const worker = new Worker(new URL('../../../workers/basic-pitch.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => {
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      // Ask politely (stops between 2 s windows), then terminate: the promise settles now either way.
      worker.postMessage({ type: 'cancel' } satisfies BasicPitchRequest);
      finish();
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (ev: MessageEvent<BasicPitchResponse>) => {
      const msg = ev.data;
      if (msg.type === 'progress') {
        if (msg.stage === 'transcribing') onProgress(msg.value);
      } else if (msg.type === 'result') {
        finish();
        resolve(msg.notes);
      } else if (msg.type === 'cancelled') {
        finish();
        reject(abortError());
      } else {
        finish();
        reject(new Error(`Transcription failed: ${msg.message}`));
      }
    };
    worker.onerror = (ev) => {
      finish();
      reject(new Error(`Transcription worker crashed: ${ev.message || 'unknown error'}`));
    };
    const req: BasicPitchRequest = { type: 'transcribe', audio, modelUrl: modelUrl() };
    worker.postMessage(req, [audio.buffer]);
  });
}

export async function transcribeMediaFile(
  file: File,
  opts: AudioConvertOptions,
  onProgress: ProgressFn,
  signal: AbortSignal,
): Promise<Score> {
  if (signal.aborted) throw abortError();
  onProgress(0, 'decoding');
  const audio = await decodeToMono22k(file, signal);
  onProgress(DECODE_END, 'transcribing');
  const raw = await transcribeInWorker(
    audio,
    (p) => onProgress(DECODE_END + (INFER_END - DECODE_END) * p, 'transcribing'),
    signal,
  );
  if (signal.aborted) throw abortError();
  onProgress(INFER_END, 'post-processing');
  const score = postprocess(raw, { ...opts.postprocess, title: titleFromFileName(file.name) });
  onProgress(1);
  return score;
}
