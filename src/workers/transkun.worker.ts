/// <reference lib="webworker" />
/**
 * High-precision piano transcription (Transkun, MIT) off the UI thread, on onnxruntime-web: WebGPU
 * when the browser has it, else WebAssembly (multi-threaded only when the page is cross-origin
 * isolated). This worker and onnxruntime are only loaded when the user picks the mode.
 *
 * Every byte comes from the app's own origin: the model files from public/models/transkun (put there
 * by scripts/fetch-transkun.mjs) and onnxruntime's .wasm as a Vite asset of this worker. The service
 * worker caches them at runtime (vite.config.ts), so the mode works offline after its first use.
 *
 * In: transcribe { id, channels (44,100 Hz), modelBase, title }. Out: progress · result · error.
 * Cancel = the client terminates the worker (frees the GPU and the ~0.5 GB of buffers at once).
 */
import * as ort from 'onnxruntime-web/webgpu';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import { downmix, peakLevel, SILENCE_PEAK } from '../converters/inputs/audio/mono';
import { epochNow, type TimingSpan } from '../converters/inputs/audio/timing';
import { TK_DOWNLOAD_BYTES, TK_MODEL_FILES, TK_TRACKS } from '../converters/inputs/audio/transkun/constants';
import type { TranskunRequest, TranskunResponse } from '../converters/inputs/audio/transkun/protocol';
import { transkunToScore } from '../converters/inputs/audio/transkun/to-score';
import { transcribeTranskun, type TranskunModel } from '../converters/inputs/audio/transkun/transcribe';

declare const self: DedicatedWorkerGlobalScope;

class ModelMissing extends Error {}

interface Loaded {
  model: TranskunModel;
  backend: string;
  base: string;
}
let loaded: Loaded | null = null;

function post(msg: TranskunResponse): void {
  self.postMessage(msg);
}

/** Fetches several files into memory, reporting the bytes received over all of them. */
async function fetchAll(urls: string[], expected: number[], onBytes: (done: number, total: number) => void): Promise<Uint8Array[]> {
  const total = expected.reduce((a, b) => a + b, 0);
  const got = urls.map(() => 0);
  const report = () => onBytes(got.reduce((a, b) => a + b, 0), total);
  return Promise.all(
    urls.map(async (url, i) => {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new ModelMissing(`${url}: HTTP ${res.status}`);
      const type = res.headers.get('content-type') ?? '';
      // A dev server or SPA host answers a missing file with index.html.
      if (type.includes('text/html')) throw new ModelMissing(`${url}: not found`);
      const chunks: Uint8Array[] = [];
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got[i]! += value.byteLength;
        report();
      }
      const out = new Uint8Array(got[i]!);
      let off = 0;
      for (const c of chunks) {
        out.set(c, off);
        off += c.byteLength;
      }
      return out;
    }),
  );
}

async function createSession(bytes: Uint8Array, gpu: boolean): Promise<{ session: ort.InferenceSession; backend: string }> {
  if (gpu) {
    try {
      // NCHW: with the WebGPU EP's default NHWC layout the first Conv (6 input channels) comes out wrong
      // in onnxruntime-web 1.31.1 (S off by up to 13 %); in NCHW it matches the CPU (docs/DECISIONS.md).
      const ep = { name: 'webgpu', preferredLayout: 'NCHW' } as const;
      return { session: await ort.InferenceSession.create(bytes, { executionProviders: [ep] }), backend: 'webgpu' };
    } catch {
      // No adapter, lost device or an unsupported op: fall back to the CPU (WebAssembly).
    }
  }
  return { session: await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }), backend: 'wasm' };
}

async function load(id: number, base: string, spans: TimingSpan[]): Promise<Loaded> {
  if (loaded && loaded.base === base) return loaded;
  const t0 = epochNow();
  const step = (stage: 'downloading-model' | 'loading-model', value: number, done?: number, total?: number) =>
    post({ type: 'progress', id, stage, value, done, total });
  step('downloading-model', 0, 0, TK_DOWNLOAD_BYTES.main + TK_DOWNLOAD_BYTES.heads + TK_DOWNLOAD_BYTES.wasm);
  const [main, heads, wasm] = await fetchAll(
    [new URL(TK_MODEL_FILES.main, base).href, new URL(TK_MODEL_FILES.heads, base).href, new URL(wasmUrl, self.location.href).href],
    [TK_DOWNLOAD_BYTES.main, TK_DOWNLOAD_BYTES.heads, TK_DOWNLOAD_BYTES.wasm],
    (done, total) => step('downloading-model', Math.min(1, done / total), done, total),
  );
  const t1 = epochNow();
  spans.push({ stage: 'download', start: t0, end: t1 });
  step('loading-model', 0);

  ort.env.wasm.wasmBinary = wasm!;
  // Threads need SharedArrayBuffer, i.e. a cross-origin isolated page; otherwise one thread.
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)) : 1;
  ort.env.wasm.proxy = false;
  const gpu = 'gpu' in navigator && !!(await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
  const m = await createSession(main!, gpu);
  step('loading-model', 0.8);
  // The heads see a few hundred rows per segment: the CPU is as fast as a GPU round trip.
  const h = await ort.InferenceSession.create(heads!, { executionProviders: ['wasm'] });
  step('loading-model', 1);
  spans.push({ stage: 'model-load', start: t1, end: epochNow() });

  const model: TranskunModel = {
    async main(features, frames) {
      const input = new ort.Tensor('float32', features, [1, frames, 229, 6]);
      const out = await m.session.run({ featuresBatch: input });
      const S = (await out.S!.getData()) as Float32Array;
      const ctx = (await out.ctx!.getData()) as Float32Array;
      input.dispose();
      out.S!.dispose();
      out.ctx!.dispose();
      if (S.length !== frames * frames * TK_TRACKS) throw new Error('unexpected model output');
      return { S, ctx };
    },
    async heads(attr, n) {
      const out = await h.run({ attr: new ort.Tensor('float32', attr, [n, 768]) });
      return { velLogits: out.velLogits!.data as Float32Array, ofRaw: out.ofRaw!.data as Float32Array };
    },
  };
  loaded = { model, backend: m.backend, base };
  return loaded;
}

async function handle(req: TranskunRequest): Promise<void> {
  const { id } = req;
  const spans: TimingSpan[] = [];
  try {
    const tMix = epochNow();
    const mono = downmix(req.channels);
    spans.push({ stage: 'downmix', start: tMix, end: epochNow() });
    // Loudest channel, not the mix: the front end reads the channels separately (opposite-phase stereo is not silent).
    if (mono.length === 0 || Math.max(...req.channels.map(peakLevel)) < SILENCE_PEAK) {
      post({ type: 'error', id, code: 'silent', message: 'no audible sound' });
      return;
    }
    const { model, backend } = await load(id, req.modelBase, spans);
    const tInfer = epochNow();
    post({ type: 'progress', id, stage: 'transcribing', value: 0 });
    // Upstream averages the channels' power spectra; pass them separately (at most two).
    const channels = req.channels.length <= 2 ? req.channels : [mono];
    const events = await transcribeTranskun(channels, model, {
      onSegment: (done, total) => post({ type: 'progress', id, stage: 'transcribing', value: done / total, done, total }),
    });
    const tPost = epochNow();
    spans.push({ stage: 'inference', start: tInfer, end: tPost });
    post({ type: 'progress', id, stage: 'finishing', value: 0 });
    const score = transkunToScore(events, { title: req.title });
    spans.push({ stage: 'postprocess', start: tPost, end: epochNow() });
    post({ type: 'result', id, score, backend, spans });
  } catch (err) {
    loaded = null;
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'error', id, message, ...(err instanceof ModelMissing ? { code: 'model-missing' as const } : {}) });
  }
}

// With threads (cross-origin isolated pages), onnxruntime starts its pthreads from this same script
// with the name "em-pthread…"; those must keep Emscripten's own message handler.
if (!self.name.startsWith('em-pthread')) {
  // Errors thrown inside library promises never reach Worker.onerror; report them instead of hanging.
  self.addEventListener('unhandledrejection', (ev) => {
    const reason: unknown = ev.reason;
    post({ type: 'error', id: -1, message: reason instanceof Error ? reason.message : String(reason) });
  });

  let queue: Promise<void> = Promise.resolve();
  self.onmessage = (ev: MessageEvent<TranskunRequest>) => {
    queue = queue.then(() => handle(ev.data));
  };
}
