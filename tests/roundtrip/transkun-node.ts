/**
 * Transkun graphs in Node for the opt-in round-trip test: the same onnxruntime-web package the
 * worker uses (its Node build runs the WebAssembly CPU backend, multi-threaded), model files read
 * from public/models/transkun (scripts/fetch-transkun.mjs). No network.
 */
import { existsSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import * as ort from 'onnxruntime-web';
import { TK_MODEL_FILES } from '../../src/converters/inputs/audio/transkun/constants';
import type { TranskunModel } from '../../src/converters/inputs/audio/transkun/transcribe';

export const TRANSKUN_DIR = resolve('public/models/transkun');

export function transkunInstalled(): boolean {
  return Object.values(TK_MODEL_FILES).every((f) => existsSync(resolve(TRANSKUN_DIR, f)));
}

export async function loadTranskunNode(): Promise<TranskunModel> {
  ort.env.wasm.numThreads = Math.min(8, cpus().length);
  const opts: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'] };
  const main = await ort.InferenceSession.create(readFileSync(resolve(TRANSKUN_DIR, TK_MODEL_FILES.main)), opts);
  const heads = await ort.InferenceSession.create(readFileSync(resolve(TRANSKUN_DIR, TK_MODEL_FILES.heads)), opts);
  return {
    async main(features, frames) {
      const out = await main.run({ featuresBatch: new ort.Tensor('float32', features, [1, frames, 229, 6]) });
      return { S: out.S!.data as Float32Array, ctx: out.ctx!.data as Float32Array };
    },
    async heads(attr, n) {
      const out = await heads.run({ attr: new ort.Tensor('float32', attr, [n, 768]) });
      return { velLogits: out.velLogits!.data as Float32Array, ofRaw: out.ofRaw!.data as Float32Array };
    },
  };
}
