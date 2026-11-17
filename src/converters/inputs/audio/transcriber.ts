/**
 * Main-thread client of the long-lived Basic Pitch worker (browser only).
 *
 * - One worker per page, created on demand and kept warm between conversions: the model, the
 *   tfjs backend and its compiled GPU programs survive, so only the first conversion pays for
 *   them. `prewarmAudioTranscriber()` starts that work early (e.g. when a file is dropped).
 * - After IDLE_MS without jobs the worker is terminated to give its GPU/CPU memory back.
 * - Cancel is cooperative (between 2 s windows); a worker that does not confirm within
 *   CANCEL_GRACE_MS is terminated, and a crashed worker is replaced on the next call.
 */
import type { Score } from '../../../core/score';
import type { DecodeParams } from './basic-pitch-run';
import type { PostprocessOptions } from './postprocess';
import type { BasicPitchRequest, BasicPitchResponse, WorkerStage } from './protocol';
import { recordSpan, type TimingSpan } from './timing';

const IDLE_MS = 5 * 60_000;
const CANCEL_GRACE_MS = 10_000;

export interface WarmInfo {
  backend: string;
  /** Measured time of one 2 s model window (ms). */
  windowMs: number;
}

export interface TranscribeResult {
  score: Score;
  backend: string;
  spans: TimingSpan[];
}

export type WorkerProgress = (stage: WorkerStage, value: number, windows?: number) => void;

/** The audio has no audible sound (reported by the worker after downmixing). */
export class SilentAudioError extends Error {
  constructor() {
    super('no audible sound');
    this.name = 'SilentAudioError';
  }
}

interface Job {
  onMessage(msg: BasicPitchResponse): void;
  fail(err: Error): void;
}

export function modelUrl(): string {
  const base = typeof document !== 'undefined' ? document.baseURI : self.location.href;
  return new URL(`${import.meta.env.BASE_URL}models/basic-pitch/model.json`, base).href;
}

function abortError(): DOMException {
  return new DOMException('Conversion cancelled', 'AbortError');
}

let worker: Worker | null = null;
let nextId = 1;
const jobs = new Map<number, Job>();
let warm: Promise<WarmInfo> | null = null;
let warmInfo: WarmInfo | null = null;
/** Progress listeners of jobs waiting for an in-flight warm-up. */
const warmListeners = new Set<(value: number) => void>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function reset(reason: Error): void {
  worker?.terminate();
  worker = null;
  warm = null;
  warmInfo = null;
  const pending = [...jobs.values()];
  jobs.clear();
  for (const j of pending) j.fail(reason);
}

function scheduleIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (jobs.size > 0 || !worker) return;
  idleTimer = setTimeout(() => {
    if (jobs.size === 0) reset(new Error('idle'));
  }, IDLE_MS);
}

function getWorker(): Worker {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (worker) return worker;
  const w = new Worker(new URL('../../../workers/basic-pitch.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (ev: MessageEvent<BasicPitchResponse>) => {
    const msg = ev.data;
    if (msg.id === -1) {
      reset(new Error(`Transcription failed: ${msg.type === 'error' ? msg.message : 'unknown error'}`));
      return;
    }
    jobs.get(msg.id)?.onMessage(msg);
  };
  w.onerror = (ev) => reset(new Error(`Transcription worker crashed: ${ev.message || 'unknown error'}`));
  worker = w;
  return w;
}

function send(req: BasicPitchRequest, transfer: Transferable[] = []): void {
  getWorker().postMessage(req, transfer);
}

/** Loads the model and compiles the backend once; later calls return the same promise. */
export function warmUp(): Promise<WarmInfo> {
  if (warm) return warm;
  const id = nextId++;
  const p = new Promise<WarmInfo>((resolve, reject) => {
    jobs.set(id, {
      onMessage: (msg) => {
        if (msg.type === 'progress') warmListeners.forEach((l) => l(msg.value));
        else if (msg.type === 'ready') {
          jobs.delete(id);
          warmInfo = { backend: msg.backend, windowMs: msg.windowMs };
          for (const s of msg.spans) recordSpan(s, { backend: msg.backend, programs: msg.programs });
          resolve(warmInfo);
          scheduleIdle();
        } else if (msg.type === 'error' || msg.type === 'cancelled') {
          jobs.delete(id);
          reject(new Error(msg.type === 'error' ? `Model loading failed: ${msg.message}` : 'cancelled'));
          scheduleIdle();
        }
      },
      fail: reject,
    });
  });
  warm = p;
  p.catch(() => {
    if (warm === p) warm = null; // retry next time
  });
  send({ type: 'warmup', id, modelUrl: modelUrl() });
  return p;
}

/**
 * Starts loading the model in the background (no-op if already loaded or loading). Call it as
 * soon as an audio or video file is chosen; the conversion then starts warm. Never throws.
 */
export function prewarmAudioTranscriber(): void {
  if (typeof Worker === 'undefined') return;
  warmUp().catch(() => {
    // The conversion itself will retry and report the error.
  });
}

/** Warm state right now: measured window time once warm, else null. */
export function currentWarmInfo(): WarmInfo | null {
  return warmInfo;
}

/**
 * Downmix + Basic Pitch + note clean-up in the worker. `channels` (22,050 Hz) are transferred.
 * Progress: loading-model (only while the model is not ready yet), transcribing, finishing.
 */
export function transcribeChannels(
  channels: Float32Array[],
  opts: { params?: Partial<DecodeParams>; postprocess?: Partial<PostprocessOptions> },
  onProgress: WorkerProgress,
  signal: AbortSignal,
): Promise<TranscribeResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const id = nextId++;
    // Report an in-flight warm-up as this job's model-loading stage.
    const warmListener = (v: number) => onProgress('loading-model', v);
    if (warm && !warmInfo) warmListeners.add(warmListener);
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const done = () => {
      warmListeners.delete(warmListener);
      signal.removeEventListener('abort', onAbort);
      jobs.delete(id);
      scheduleIdle();
    };
    const onAbort = () => {
      done();
      reject(abortError());
      if (!worker) return;
      // Keep the warm worker if it stops in time; otherwise replace it.
      const w = worker;
      jobs.set(id, {
        onMessage: (msg) => {
          if (msg.type === 'cancelled' || msg.type === 'result' || msg.type === 'error') {
            if (watchdog) clearTimeout(watchdog);
            jobs.delete(id);
            scheduleIdle();
          }
        },
        fail: () => {
          if (watchdog) clearTimeout(watchdog);
        },
      });
      watchdog = setTimeout(() => {
        if (worker === w && jobs.has(id)) reset(new Error('cancel timed out'));
      }, CANCEL_GRACE_MS);
      w.postMessage({ type: 'cancel', id } satisfies BasicPitchRequest);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    jobs.set(id, {
      onMessage: (msg) => {
        switch (msg.type) {
          case 'progress':
            onProgress(msg.stage, msg.value, msg.windows);
            return;
          case 'result':
            done();
            resolve({ score: msg.score, backend: msg.backend, spans: msg.spans });
            return;
          case 'cancelled':
            done();
            reject(abortError());
            return;
          case 'error':
            done();
            reject(msg.code === 'silent' ? new SilentAudioError() : new Error(`Transcription failed: ${msg.message}`));
            return;
          case 'ready':
            return;
        }
      },
      fail: (err) => {
        done();
        reject(err);
      },
    });
    send(
      { type: 'transcribe', id, channels, modelUrl: modelUrl(), params: opts.params, postprocess: opts.postprocess },
      channels.map((c) => c.buffer),
    );
  });
}
