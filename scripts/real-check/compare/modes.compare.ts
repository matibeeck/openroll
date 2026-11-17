/**
 * Fast (Basic Pitch) vs high precision (Transkun) — local check, never in CI, nothing written to the repo.
 *
 *   npm run real-check:compare                                  evaluation fixtures + download sizes
 *   REAL_RECORDING=/path/to/recording npm run real-check:compare   + the real recording (cold / warm, octaves)
 *
 * 1. Note F1 (pitch exact, onset ±50 ms) on the recording-like EVALUATION set of
 *    tests/fixtures/audio-realistic.ts (20 renders, 22,050 Hz WAVs written to the temp dir), both modes,
 *    through the real UI and the MIDI download. Report only: nothing is tuned on these.
 * 2. REAL_RECORDING (only from the env var; skipped when unset) as "Real performance", per mode in a
 *    freshly launched browser: one cold conversion (model download/compile included) and one warm.
 *    Prints time, note count and the right-hand C octaves: onsets of C4–C7 and how many of them have
 *    the C an octave above within ±50 ms (the reference recording's theme sits over repeated C5+C6 octaves).
 * 3. Download size of each mode (raw and gzip) from the build.
 * Results also go to $TMPDIR/openroll-real-check/compare.json.
 */
import { chromium, expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { realisticEvaluationSet, renderRealistic, type RealisticPiece } from '../../../tests/fixtures/audio-realistic';
import { noteF1, type TimedPitch } from '../../../tests/roundtrip/metrics';

const { Midi } = createRequire(import.meta.url)('@tonejs/midi') as typeof import('@tonejs/midi');

type Mode = 'fast' | 'precise';
const MODES: Mode[] = ['fast', 'precise'];
const OUT_DIR = join(tmpdir(), 'openroll-real-check');
const BUILD_DIR = process.env.RC_OUT_DIR ?? join(tmpdir(), 'openroll-real-check-compare-dist');
const RECORDING = process.env.REAL_RECORDING ?? '';
const results: Record<string, unknown> = {};

function wav16(samples: Float32Array, sampleRate: number): Buffer {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), 44 + i * 2);
  return buf;
}

/** Opens a file, answers the questions, waits for the result; returns wall ms and the stage measures. */
async function convert(page: Page, path: string, mode: Mode, video: boolean) {
  await page.evaluate(() => performance.clearMeasures());
  const t0 = Date.now();
  await page.getByTestId('file-input').setInputFiles(path);
  if (video) await page.getByRole('button', { name: 'Real performance' }).click();
  await page.getByTestId(`mode-${mode}`).click();
  await expect(page.getByTestId('score-summary')).toBeVisible({ timeout: 600_000 });
  const wallMs = Date.now() - t0;
  const stages = await page.evaluate(() => {
    const out: Record<string, number> = {};
    let backend = '';
    for (const m of performance.getEntriesByType('measure') as PerformanceMeasure[]) {
      if (!m.name.startsWith('openroll:audio:')) continue;
      const k = m.name.slice('openroll:audio:'.length);
      out[k] = Math.round((out[k] ?? 0) + m.duration);
      const d = m.detail as { backend?: string; mode?: string } | null;
      if (d?.backend && (k === 'total' || !backend)) backend = d.backend;
    }
    return { out, backend };
  });
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('tab', { name: 'Download' }).click();
      await page.getByTestId('download-midi').click();
    })(),
  ]);
  const midi = new Midi(readFileSync(await dl.path()));
  const notes: TimedPitch[] = midi.tracks
    .flatMap((t) => t.notes.map((n) => ({ pitch: n.midi, start: n.time })))
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  await page.getByRole('button', { name: 'OpenRoll' }).click();
  return { wallMs, totalMs: stages.out.total ?? wallMs, stages: stages.out, backend: stages.backend, notes };
}

/** C onsets per octave and how many have the C an octave above sounding with them (onsets within ±50 ms). */
function octaves(notes: TimedPitch[]) {
  const name = (p: number) => `C${p / 12 - 1}`;
  const counts: Record<string, number> = {};
  const pairs: Record<string, number> = {};
  for (const p of [60, 72, 84, 96]) {
    const lo = notes.filter((n) => n.pitch === p);
    counts[name(p)] = lo.length;
    if (p < 96) pairs[`${name(p)}+${name(p + 12)}`] = lo.filter((n) => notes.some((m) => m.pitch === p + 12 && Math.abs(m.start - n.start) <= 0.05)).length;
  }
  return { counts, pairs };
}

function dirSize(dir: string, match: (f: string) => boolean): { raw: number; gzip: number; files: string[] } {
  if (!existsSync(dir)) return { raw: 0, gzip: 0, files: [] };
  let raw = 0;
  let gzip = 0;
  const files: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!match(f)) continue;
    const p = join(dir, f);
    raw += statSync(p).size;
    gzip += gzipSync(readFileSync(p), { level: 6 }).length;
    files.push(f);
  }
  return { raw, gzip, files };
}

const mb = (b: number) => (b / 1e6).toFixed(1);

test.describe.configure({ mode: 'serial' });

test('download size per mode', () => {
  const assets = join(BUILD_DIR, 'assets');
  const fast = [
    dirSize(join(BUILD_DIR, 'models/basic-pitch'), () => true),
    dirSize(assets, (f) => /^basic-pitch\.worker-.*\.js$/.test(f)),
  ];
  const precise = [
    dirSize(join(BUILD_DIR, 'models/transkun'), (f) => f.endsWith('.onnx')),
    dirSize(assets, (f) => /^ort-wasm-.*\.wasm$/.test(f)),
    dirSize(assets, (f) => /^transkun\.worker-.*\.js$/.test(f)),
  ];
  const sum = (xs: { raw: number; gzip: number }[]) => ({ raw: xs.reduce((s, x) => s + x.raw, 0), gzip: xs.reduce((s, x) => s + x.gzip, 0) });
  const f = sum(fast);
  const p = sum(precise);
  console.log(`[compare] download fast (Basic Pitch model + worker, precached with the app): ${mb(f.raw)} MB (gzip ${mb(f.gzip)} MB)`);
  console.log(
    `[compare] download precise (Transkun model ${mb(precise[0]!.raw)} MB + onnxruntime wasm ${mb(precise[1]!.raw)} MB + worker ${mb(precise[2]!.raw)} MB, on first use): ` +
      `${mb(p.raw)} MB (gzip ${mb(p.gzip)} MB)`,
  );
  results.download = { fast: f, precise: p };
  expect(p.raw).toBeGreaterThan(0);
});

test('evaluation fixtures: note F1 per mode', async ({ baseURL }) => {
  const dir = join(OUT_DIR, 'eval-wav');
  mkdirSync(dir, { recursive: true });
  const pieces: (RealisticPiece & { path: string })[] = realisticEvaluationSet().map((p) => {
    const path = join(dir, `${p.name.replace(/\W+/g, '_')}.wav`);
    if (!existsSync(path)) writeFileSync(path, wav16(renderRealistic(p), 22050));
    return { ...p, path };
  });
  const table: Record<string, Record<Mode, number>> = {};
  for (const mode of MODES) {
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseURL}/?lang=en`);
      let totalMs = 0;
      let backend = '';
      for (const p of pieces) {
        const r = await convert(page, p.path, mode, false);
        totalMs += r.totalMs;
        backend ||= r.backend;
        const m = noteF1(p.score.notes, r.notes, 0.05);
        (table[p.name] ??= {} as Record<Mode, number>)[mode] = m.f1;
        console.log(
          `[compare] ${mode.padEnd(7)} ${p.name.padEnd(18)} F1 ${(m.f1 * 100).toFixed(1).padStart(5)}% (P ${(m.precision * 100).toFixed(1)}, R ${(m.recall * 100).toFixed(1)}) ${r.totalMs} ms`,
        );
      }
      const f1s = pieces.map((p) => table[p.name]![mode]);
      const mean = f1s.reduce((a, b) => a + b, 0) / f1s.length;
      console.log(`[compare] ${mode}: mean note F1 over ${pieces.length} evaluation renders ${(mean * 100).toFixed(1)}% · backend ${backend} · ${(totalMs / 1000).toFixed(1)} s total`);
      results[`eval-${mode}`] = { mean, backend, totalMs };
    } finally {
      await browser.close();
    }
  }
  const variants = ['room', 'pedal', 'soft', 'all'];
  for (const v of variants) {
    const rows = Object.entries(table).filter(([k]) => k.endsWith(`/${v}`));
    const mean = (mode: Mode) => rows.reduce((s, [, r]) => s + r[mode], 0) / rows.length;
    console.log(`[compare] variant ${v.padEnd(5)}: fast ${(mean('fast') * 100).toFixed(1)}% · precise ${(mean('precise') * 100).toFixed(1)}%`);
  }
  results.eval = table;
});

test('real recording: time, notes and right-hand octaves per mode', async ({ baseURL }) => {
  test.skip(!RECORDING, 'REAL_RECORDING is not set: pass the path of a recording to compare the modes on it');
  test.skip(!existsSync(RECORDING), `REAL_RECORDING not found: ${RECORDING}`);
  const video = /\.(mp4|mov|m4v|webm)$/i.test(RECORDING);
  for (const mode of MODES) {
    // A fresh browser per mode: empty HTTP and service-worker caches, so "cold" includes the model download.
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseURL}/?lang=en`);
      const runs = [];
      for (let i = 0; i < 2; i++) runs.push(await convert(page, RECORDING, mode, video));
      for (const [i, r] of runs.entries()) {
        const o = octaves(r.notes);
        const st = Object.entries(r.stages)
          .map(([k, v]) => `${k} ${v}`)
          .join(' · ');
        console.log(
          `[compare] recording ${mode} ${i === 0 ? 'cold' : 'warm'}: ${(r.wallMs / 1000).toFixed(2)} s wall (${(r.totalMs / 1000).toFixed(2)} s conversion) · ` +
            `backend ${r.backend} · ${r.notes.length} notes · C onsets ${JSON.stringify(o.counts)} · octave pairs ${JSON.stringify(o.pairs)}\n[compare]   stages ms: ${st}`,
        );
      }
      // Note list for a closer look (temp dir only; derived from the recording, never committed).
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(join(OUT_DIR, `notes-compare-${mode}.json`), JSON.stringify(runs[0]!.notes));
      results[`recording-${mode}`] = runs.map((r) => ({ wallMs: r.wallMs, totalMs: r.totalMs, stages: r.stages, backend: r.backend, notes: r.notes.length, ...octaves(r.notes) }));
    } finally {
      await browser.close();
    }
  }
});

test.afterAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'compare.json'), JSON.stringify(results, null, 1));
});
