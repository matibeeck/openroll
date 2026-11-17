/**
 * Main-thread client for the shared Verovio worker. One long-lived worker keeps Verovio warm.
 * Never import src/core/verovio.ts from main-thread code: that would bundle a second Verovio copy.
 */
import type { VerovioJob, VerovioJobResult, VerovioRequest, VerovioResponse } from './verovio-protocol';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

export class VerovioWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerovioWorkerError';
  }
}

function abortError(): DOMException {
  return new DOMException('Cancelled', 'AbortError');
}

function getWorker(): Worker {
  if (worker) return worker;
  if (typeof Worker === 'undefined') throw new VerovioWorkerError('This browser cannot run Web Workers');
  const w = new Worker(new URL('./verovio.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<VerovioResponse>) => {
    const job = pending.get(e.data.id);
    if (!job) return; // cancelled
    pending.delete(e.data.id);
    if (e.data.ok) job.resolve(e.data.result);
    else job.reject(new VerovioWorkerError(e.data.error));
  };
  w.onerror = (e) => {
    killWorker(w, new VerovioWorkerError(e.message || 'Verovio worker failed'));
  };
  worker = w;
  return w;
}

function killWorker(w: Worker, reason: Error): void {
  w.terminate();
  if (worker !== w) return;
  worker = null;
  for (const job of pending.values()) job.reject(reason);
  pending.clear();
}

export interface JobOptions {
  signal?: AbortSignal;
  /** Bytes to transfer instead of copy. */
  transfer?: Transferable[];
  /**
   * Stop the running job on abort by killing the worker (Verovio calls are synchronous; the
   * next job pays the cold start again). Otherwise the result is just ignored.
   */
  killOnAbort?: boolean;
}

export function runVerovioJob<J extends VerovioJob>(job: J, opts: JobOptions = {}): Promise<VerovioJobResult[J['type']]> {
  const { signal } = opts;
  if (signal?.aborted) return Promise.reject(abortError());
  const w = getWorker();
  const id = nextId++;
  return new Promise<VerovioJobResult[J['type']]>((resolve, reject) => {
    const onAbort = () => {
      pending.delete(id);
      if (opts.killOnAbort) killWorker(w, abortError());
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    pending.set(id, {
      resolve: (v) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(v as VerovioJobResult[J['type']]);
      },
      reject: (e) => {
        signal?.removeEventListener('abort', onAbort);
        reject(e);
      },
    });
    const msg = { ...job, id } as VerovioRequest;
    w.postMessage(msg, opts.transfer ?? []);
  });
}
