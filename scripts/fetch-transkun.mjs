// Downloads the Transkun model (high-precision piano mode) into public/models/transkun/ at setup
// time, so the app serves it from its own origin: the running app never calls another host.
// Runs on postinstall, predev and prebuild; skips files that are already there and verified.
//
// Source: huggingface.co/TuesdayCrowd/transkun-onnx (MIT), pinned to one revision and checked by
// SHA-256. Its graphs give bit-identical outputs to our own export of the MIT `transkun` 2.0.1 pip
// weights (scripts/transkun/export_onnx.py --compare; see docs/DECISIONS.md).
//
//   node scripts/fetch-transkun.mjs            download/verify (warns and exits 0 when offline)
//   node scripts/fetch-transkun.mjs --strict   exit 1 if the model is not installed afterwards
//   node scripts/fetch-transkun.mjs --from DIR copy transkun.onnx + transkun-heads.onnx from DIR
//                                              (e.g. the output of export_onnx.py; not hash-checked)
// TRANSKUN_SKIP=1 skips it (the app then reports that the high-precision model is not installed).
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Changing it? Also rename the runtime cache in vite.config.ts (openroll-transkun-<revision>).
const REVISION = 'b44598166715a50d863973a8ecbbdbbb392f08d6';
const BASE = `https://huggingface.co/TuesdayCrowd/transkun-onnx/resolve/${REVISION}`;
const FILES = [
  { name: 'transkun.onnx', size: 53_391_226, sha256: '6d6960ecbce5c3d51051ebc1ebdeec4d3018ea6cfd360fb1ae96359aa7a075a3' },
  { name: 'transkun-heads.onnx', size: 3_422_740, sha256: 'f609f53fbb4df0a2165f941aff1d5a1c1063ba40aaa699365448dca5d9f3544d' },
];
const LICENSE = `Transkun model weights (transkun.onnx, transkun-heads.onnx)
Exported from the pip package transkun 2.0.1, https://github.com/Yujia-Yan/Transkun
ONNX export: https://huggingface.co/TuesdayCrowd/transkun-onnx (MIT)

MIT License

Copyright (c) 2021 Yujia Yan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const root = join(import.meta.dirname, '..');
const dst = join(root, 'public/models/transkun');
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const fromIdx = args.indexOf('--from');
const from = fromIdx >= 0 ? args[fromIdx + 1] : undefined;

async function sha256(path) {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

async function verified(path, f) {
  return existsSync(path) && statSync(path).size === f.size && (await sha256(path)) === f.sha256;
}

async function download(f) {
  const path = join(dst, f.name);
  if (await verified(path, f)) return 'ok';
  const tmp = `${path}.part`;
  const res = await fetch(`${BASE}/${f.name}`, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`${f.name}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  const got = await sha256(tmp);
  if (got !== f.sha256) {
    rmSync(tmp, { force: true });
    throw new Error(`${f.name}: SHA-256 mismatch (got ${got})`);
  }
  renameSync(tmp, path);
  return 'downloaded';
}

async function main() {
  if (process.env.TRANSKUN_SKIP === '1') {
    console.log('[fetch-transkun] TRANSKUN_SKIP=1: skipped');
    return;
  }
  mkdirSync(dst, { recursive: true });
  writeFileSync(join(dst, 'LICENSE.txt'), LICENSE);
  if (from) {
    for (const f of FILES) {
      copyFileSync(join(from, f.name), join(dst, f.name));
      console.log(`[fetch-transkun] copied ${f.name} from ${from} (sha256 ${await sha256(join(dst, f.name))})`);
    }
    return;
  }
  const states = [];
  for (const f of FILES) states.push(`${f.name} ${await download(f)}`);
  console.log(`[fetch-transkun] Transkun (MIT) in public/models/transkun: ${states.join(', ')}`);
}

main().catch((e) => {
  const msg = `[fetch-transkun] could not install the high-precision piano model: ${e.message}. ` +
    'The app still builds; its high-precision mode will report the model as missing. Re-run `node scripts/fetch-transkun.mjs` when online.';
  console.warn(msg);
  if (strict) process.exit(1);
});
