/// <reference lib="webworker" />
/**
 * Basic Pitch inference off the UI thread, in a long-lived worker that stays warm between
 * conversions (src/converters/inputs/audio/transcriber.ts owns its lifetime).
 *
 * In:  warmup { id, modelUrl } · transcribe { id, channels (22,050 Hz), modelUrl, params?, postprocess? }
 *      · cancel { id }
 * Out: progress { id, stage, value } · ready { id, backend, windowMs } · result { id, score }
 *      · cancelled { id } · error { id, message, code? }
 *
 * Jobs run one at a time, in arrival order. All per-sample work (downmix, silence check) and the
 * note clean-up run here, so the main thread only decodes the file.
 * The model is loaded from the app's own origin (public/models/basic-pitch), never a CDN.
 */
import * as tf from '@tensorflow/tfjs';
import {
  decodeNotes,
  DEFAULT_DECODE_PARAMS,
  runModel,
  TranscriptionCancelled,
} from '../converters/inputs/audio/basic-pitch-run';
import { downmix, modelWindows, peakLevel, SILENCE_PEAK } from '../converters/inputs/audio/mono';
import { postprocess } from '../converters/inputs/audio/postprocess';
import type { BasicPitchRequest, BasicPitchResponse } from '../converters/inputs/audio/protocol';
import { epochNow, type TimingSpan } from '../converters/inputs/audio/timing';

declare const self: DedicatedWorkerGlobalScope;

// tfjs 3.x bug: its browser platform's setTimeoutCustom (used by the WebGL backend while it waits
// for GPU reads) evaluates `!window`, which throws ReferenceError in a worker and leaves the read
// hanging forever. Defining `window` as undefined makes it take its plain setTimeout branch.
if (!('window' in self)) (self as unknown as { window: undefined }).window = undefined;

class SilentAudio extends Error {}

interface Warm {
  model: tf.GraphModel;
  modelUrl: string;
  backend: string;
  windowMs: number;
}

let warm: Warm | null = null;
const cancelled = new Set<number>();
let queue: Promise<void> = Promise.resolve();

function post(msg: BasicPitchResponse): void {
  self.postMessage(msg);
}

/** WebGL (via OffscreenCanvas) when the browser allows it in a worker, else the CPU backend. */
async function pickBackend(): Promise<string> {
  try {
    if (await tf.setBackend('webgl')) {
      await tf.ready();
      return 'webgl';
    }
  } catch {
    // fall through to CPU
  }
  await tf.setBackend('cpu');
  await tf.ready();
  return 'cpu';
}

/** Number of WebGL programs tfjs has compiled (private field; diagnostics only). */
function compiledPrograms(): number {
  try {
    const cache = (tf.backend() as unknown as { binaryCache?: Record<string, unknown> }).binaryCache;
    return cache ? Object.keys(cache).length : 0;
  } catch {
    return 0;
  }
}

/** Records consecutive spans: each call closes the previous one. */
function spanRecorder(spans: TimingSpan[]) {
  let t = epochNow();
  return (stage: TimingSpan['stage']) => {
    const now = epochNow();
    spans.push({ stage, start: t, end: now });
    t = now;
  };
}

/**
 * Backend + model + two runs on 1 s of silence: the first compiles the GPU programs (most of a
 * cold start), the second measures one window. Progress steps follow typical durations.
 */
async function ensureWarm(id: number, modelUrl: string, spans: TimingSpan[]): Promise<Warm> {
  if (warm && warm.modelUrl === modelUrl) return warm;
  const span = spanRecorder(spans);
  const step = (value: number) => post({ type: 'progress', id, stage: 'loading-model', value });
  step(0);
  const backend = await pickBackend();
  span('backend');
  step(0.05);
  const model = await tf.loadGraphModel(modelUrl);
  span('model-load');
  step(0.15);
  const silence = new Float32Array(22050);
  await runModel(model, silence);
  span('warmup');
  step(0.9);
  const t0 = performance.now();
  await runModel(model, silence);
  const windowMs = performance.now() - t0;
  span('warmup');
  step(1);
  warm = { model, modelUrl, backend, windowMs };
  return warm;
}

async function handle(req: Exclude<BasicPitchRequest, { type: 'cancel' }>): Promise<void> {
  const { id } = req;
  const isCancelled = () => cancelled.has(id);
  const spans: TimingSpan[] = [];
  try {
    if (isCancelled()) throw new TranscriptionCancelled();
    if (req.type === 'warmup') {
      const w = await ensureWarm(id, req.modelUrl, spans);
      post({ type: 'ready', id, backend: w.backend, windowMs: w.windowMs, programs: compiledPrograms(), spans });
      return;
    }

    const tMix = epochNow();
    const mono = downmix(req.channels);
    const silent = mono.length === 0 || peakLevel(mono) < SILENCE_PEAK;
    spans.push({ stage: 'downmix', start: tMix, end: epochNow() });
    if (silent) throw new SilentAudio();

    const w = await ensureWarm(id, req.modelUrl, spans);
    if (isCancelled()) throw new TranscriptionCancelled();

    const span = spanRecorder(spans);
    const windows = modelWindows(mono.length);
    post({ type: 'progress', id, stage: 'transcribing', value: 0, windows });
    const out = await runModel(
      w.model,
      mono,
      (p) => post({ type: 'progress', id, stage: 'transcribing', value: p, windows }),
      isCancelled,
    );
    span('inference');
    post({ type: 'progress', id, stage: 'finishing', value: 0 });
    const notes = decodeNotes(out, { ...DEFAULT_DECODE_PARAMS, ...req.params });
    span('decode-notes');
    const score = postprocess(notes, req.postprocess);
    span('postprocess');
    post({ type: 'result', id, score, backend: w.backend, spans });
  } catch (err) {
    if (err instanceof TranscriptionCancelled) post({ type: 'cancelled', id });
    else if (err instanceof SilentAudio) post({ type: 'error', id, code: 'silent', message: 'no audible sound' });
    else {
      warm = null; // start clean (backend, model download) next time
      post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
    }
  } finally {
    cancelled.delete(id);
  }
}

// Errors thrown inside library promises never reach Worker.onerror; report them instead of hanging.
self.addEventListener('unhandledrejection', (ev) => {
  const reason: unknown = ev.reason;
  post({ type: 'error', id: -1, message: reason instanceof Error ? reason.message : String(reason) });
});

self.onmessage = (ev: MessageEvent<BasicPitchRequest>) => {
  const req = ev.data;
  if (req.type === 'cancel') {
    cancelled.add(req.id);
    return;
  }
  queue = queue.then(() => handle(req));
};
