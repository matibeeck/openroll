/// <reference lib="webworker" />
/**
 * Basic Pitch inference off the UI thread.
 * In: { type: 'transcribe', audio (mono 22,050 Hz), modelUrl } or { type: 'cancel' }.
 * Out: progress (0–1), then result (raw note events), cancelled or error.
 * The model is loaded from the app's own origin (public/models/basic-pitch), never a CDN.
 */
import * as tf from '@tensorflow/tfjs';
import {
  decodeNotes,
  DEFAULT_DECODE_PARAMS,
  runModel,
  TranscriptionCancelled,
} from '../converters/inputs/audio/basic-pitch-run';
import type { BasicPitchRequest, BasicPitchResponse } from '../converters/inputs/audio/protocol';

declare const self: DedicatedWorkerGlobalScope;

// tfjs 3.x bug: its browser platform's setTimeoutCustom (used by the WebGL backend while it waits
// for GPU reads) evaluates `!window`, which throws ReferenceError in a worker and leaves the read
// hanging forever. Defining `window` as undefined makes it take its plain setTimeout branch.
if (!('window' in self)) (self as unknown as { window: undefined }).window = undefined;

let cancelled = false;
let model: Promise<tf.GraphModel> | null = null;
let modelFrom = '';

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

async function transcribe(req: Extract<BasicPitchRequest, { type: 'transcribe' }>): Promise<void> {
  cancelled = false;
  post({ type: 'progress', value: 0, stage: 'loading-model' });
  const backend = await pickBackend();
  if (!model || modelFrom !== req.modelUrl) {
    modelFrom = req.modelUrl;
    model = tf.loadGraphModel(req.modelUrl);
  }
  const loaded = await model;
  if (cancelled) throw new TranscriptionCancelled();

  const out = await runModel(
    loaded,
    req.audio,
    (p) => post({ type: 'progress', value: p, stage: 'transcribing' }),
    () => cancelled,
  );
  post({ type: 'progress', value: 1, stage: 'decoding-notes' });
  const notes = decodeNotes(out, { ...DEFAULT_DECODE_PARAMS, ...req.params });
  post({ type: 'result', notes, backend });
}

// Errors thrown inside library promises never reach Worker.onerror; report them instead of hanging.
self.addEventListener('unhandledrejection', (ev) => {
  const reason: unknown = ev.reason;
  post({ type: 'error', message: reason instanceof Error ? reason.message : String(reason) });
});

self.onmessage = (ev: MessageEvent<BasicPitchRequest>) => {
  const req = ev.data;
  if (req.type === 'cancel') {
    cancelled = true;
    return;
  }
  transcribe(req).catch((err: unknown) => {
    if (err instanceof TranscriptionCancelled) post({ type: 'cancelled' });
    else {
      model = null; // retry the download next time
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  });
};
