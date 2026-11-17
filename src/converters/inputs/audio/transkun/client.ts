/**
 * Main-thread client of the high-precision (Transkun) worker. Loaded with `import()` only when the
 * user picks the mode, so neither it nor the worker nor onnxruntime is in the main bundle.
 *
 * One worker per page, kept IDLE_MS after its last job (the loaded sessions make the next
 * conversion start at once), then terminated to give back its memory. Cancel terminates it.
 */
import type { Score } from '../../../../core/score';
import { recordSpan, type TimingSpan } from '../timing';
import { isTranskunCached, TRANSKUN_TOTAL_BYTES, transkunModelBase } from './cache';
import type { TranskunRequest, TranskunResponse, TranskunStage } from './protocol';

const IDLE_MS = 3 * 60_000;

export class TranskunModelMissingError extends Error {
  readonly code = 'model-missing';
  constructor(message: string) {
    super(message);
    this.name = 'TranskunModelMissingError';
  }
}

export class TranskunSilentError extends Error {
  constructor() {
    super('no audible sound');
    this.name = 'TranskunSilentError';
  }
}

let worker: Worker | null = null;
/** The current worker has finished a job (its sessions are loaded). */
let warm = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let nextId = 1;
/** Jobs sent to the current worker and not settled yet (the worker runs them one after another). */
const pending = new Map<number, (err: Error) => void>();

export { isTranskunCached, TRANSKUN_TOTAL_BYTES };

export function transkunWarm(): boolean {
  return warm && worker !== null;
}

/** Terminates the worker; every job still queued on it fails with `reason` (terminate fires no event). */
function kill(reason: Error): void {
  worker?.terminate();
  worker = null;
  warm = false;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const fails = [...pending.values()];
  pending.clear();
  for (const fail of fails) fail(reason);
}

/** Starts the idle countdown once no job is left. */
function scheduleIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = pending.size === 0 && worker ? setTimeout(() => kill(new Error('idle')), IDLE_MS) : null;
}

function getWorker(): Worker {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (!worker) {
    worker = new Worker(new URL('../../../../workers/transkun.worker.ts', import.meta.url), { type: 'module' });
    warm = false;
  }
  return worker;
}

export interface TranskunResult {
  score: Score;
  backend: string;
  spans: TimingSpan[];
}

/** Runs the model on 44,100 Hz channels (transferred). Rejects with AbortError when cancelled. */
export function transcribeWithTranskun(
  channels: Float32Array[],
  title: string,
  onProgress: (stage: TranskunStage, value: number, done?: number, total?: number) => void,
  signal: AbortSignal,
): Promise<TranskunResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Conversion cancelled', 'AbortError'));
    const w = getWorker();
    const id = nextId++;
    const finish = () => {
      pending.delete(id);
      signal.removeEventListener('abort', onAbort);
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
    };
    const fail = (err: Error) => {
      finish();
      reject(err);
    };
    pending.set(id, fail);
    const onAbort = () => {
      finish();
      reject(new DOMException('Conversion cancelled', 'AbortError'));
      // Stops the running model at once; other queued jobs (if any) fail and can be retried.
      kill(new Error('High-precision worker stopped because another conversion was cancelled'));
    };
    const onError = (ev: ErrorEvent) => kill(new Error(`High-precision worker crashed: ${ev.message || 'unknown error'}`));
    const onMessage = (ev: MessageEvent<TranskunResponse>) => {
      const msg = ev.data;
      if (msg.id === -1 && msg.type === 'error') return kill(new Error(`High-precision transcription failed: ${msg.message}`));
      if (msg.id !== id) return;
      if (msg.type === 'progress') return onProgress(msg.stage, msg.value, msg.done, msg.total);
      finish();
      if (msg.type === 'result') {
        warm = true;
        for (const s of msg.spans) recordSpan(s, { backend: msg.backend, mode: 'precise' });
        scheduleIdle();
        resolve({ score: msg.score, backend: msg.backend, spans: msg.spans });
        return;
      }
      if (msg.code === 'silent') {
        // Nothing went wrong in the worker: keep its loaded sessions.
        scheduleIdle();
        return reject(new TranskunSilentError());
      }
      reject(msg.code === 'model-missing' ? new TranskunModelMissingError(msg.message) : new Error(`High-precision transcription failed: ${msg.message}`));
      kill(new Error('High-precision worker restarted after an error'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    const req: TranskunRequest = { type: 'transcribe', id, channels, modelBase: transkunModelBase(), title };
    w.postMessage(req, channels.map((c) => c.buffer));
  });
}
