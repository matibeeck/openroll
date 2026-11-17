// License audit: fails if any production dependency (transitively) has a license
// outside the allowlist in CLAUDE.md. Reads package-lock.json (npm lockfile v3).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = new Set([
  'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Apache-2.0', 'MPL-2.0',
  'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0',
]);
// LGPL deps must stay unmodified and separately loaded (dynamic import / worker chunk).
const LGPL_OK = new Set(['verovio']);

function allowed(expr, name) {
  const e = expr.replace(/[()]/g, ' ').trim();
  if (/\sOR\s/.test(e)) return e.split(/\s+OR\s+/).some((p) => allowed(p, name));
  if (/\sAND\s/.test(e)) return e.split(/\s+AND\s+/).every((p) => allowed(p, name));
  if (!ALLOWED.has(e)) return false;
  if (e.startsWith('LGPL') && !LGPL_OK.has(name)) return false;
  return true;
}

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const bad = [];
const counts = {};
for (const [path, meta] of Object.entries(lock.packages)) {
  if (!path || meta.dev || meta.devOptional) continue;
  const name = path.split('node_modules/').pop();
  let lic = meta.license;
  if (!lic) {
    const pj = join(path, 'package.json');
    if (existsSync(pj)) lic = JSON.parse(readFileSync(pj, 'utf8')).license;
  }
  lic = typeof lic === 'object' && lic ? lic.type : lic || 'UNKNOWN';
  counts[lic] = (counts[lic] || 0) + 1;
  if (!allowed(lic, name)) bad.push(`${name}: ${lic}`);
}
console.log('Production licenses:', Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', '));
if (bad.length) {
  console.error('Forbidden or unknown licenses:\n  ' + bad.join('\n  '));
  process.exit(1);
}
console.log('License audit OK');
