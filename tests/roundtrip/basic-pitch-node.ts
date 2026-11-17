/**
 * Loads the Basic Pitch graph model in Node from local files (no network, no tfjs-node),
 * on the pure-JS CPU backend.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as tf from '@tensorflow/tfjs';

const SHIPPED = resolve('public/models/basic-pitch/model.json');
const PACKAGE = resolve('node_modules/@spotify/basic-pitch/model/model.json');

interface WeightsGroup {
  paths: string[];
  weights: tf.io.WeightsManifestEntry[];
}

/** Prefers the copy in public/ (what the app ships); falls back to the npm package. */
export function modelJsonPath(): string {
  return existsSync(SHIPPED) ? SHIPPED : PACKAGE;
}

export async function loadBasicPitchModelNode(path = modelJsonPath()): Promise<tf.GraphModel> {
  await tf.setBackend('cpu');
  await tf.ready();
  const json = JSON.parse(readFileSync(path, 'utf8')) as {
    modelTopology: object;
    weightsManifest: WeightsGroup[];
    format?: string;
    generatedBy?: string;
    convertedBy?: string;
    signature?: object;
    userDefinedMetadata?: tf.io.ModelArtifacts['userDefinedMetadata'];
  };
  const dir = dirname(path);
  const buffers = json.weightsManifest.flatMap((g) => g.paths.map((p) => readFileSync(join(dir, p))));
  const total = buffers.reduce((s, b) => s + b.byteLength, 0);
  const weightData = new Uint8Array(total);
  let off = 0;
  for (const b of buffers) {
    weightData.set(b, off);
    off += b.byteLength;
  }
  const handler: tf.io.IOHandler = {
    load: async () => ({
      modelTopology: json.modelTopology,
      weightSpecs: json.weightsManifest.flatMap((g) => g.weights),
      weightData: weightData.buffer,
      format: json.format,
      generatedBy: json.generatedBy,
      convertedBy: json.convertedBy,
      signature: json.signature,
      userDefinedMetadata: json.userDefinedMetadata,
    }),
  };
  return tf.loadGraphModel(handler);
}
