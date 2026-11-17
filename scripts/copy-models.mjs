// Copies ML model files from node_modules into public/ so the app serves them from its own
// origin (no CDN at runtime). Runs on postinstall and before dev/build; skips unchanged files.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const MODELS = [
  {
    name: 'Basic Pitch (Apache-2.0)',
    from: 'node_modules/@spotify/basic-pitch/model',
    to: 'public/models/basic-pitch',
  },
];

let failed = false;
for (const m of MODELS) {
  const src = join(root, m.from);
  const dst = join(root, m.to);
  const manifest = join(src, 'model.json');
  if (!existsSync(manifest)) {
    console.error(`[copy-models] ${m.name}: ${m.from}/model.json not found (run npm install)`);
    failed = true;
    continue;
  }
  const json = JSON.parse(readFileSync(manifest, 'utf8'));
  const files = ['model.json', ...json.weightsManifest.flatMap((g) => g.paths)];
  mkdirSync(dst, { recursive: true });
  let copied = 0;
  for (const f of files) {
    const a = join(src, f);
    const b = join(dst, f);
    if (existsSync(b) && statSync(b).size === statSync(a).size && readFileSync(a).equals(readFileSync(b))) continue;
    copyFileSync(a, b);
    copied++;
  }
  console.log(`[copy-models] ${m.name}: ${files.length} files in ${m.to} (${copied} updated)`);
}
if (failed) process.exit(1);
