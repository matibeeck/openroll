/**
 * Wall time of audio / performance-video → notes in the BUILT app, real Chrome, this machine.
 *
 * Scenarios (each in a freshly launched browser, so "cold" means first conversion after page load):
 *   - the real recording (default ~/Downloads/recording.mov, or REAL_RECORDING=path), as "Real performance"
 *   - a 60 s synthetic two-hand piano WAV (44.1 kHz stereo, generated here; never committed)
 * Each: cold, then two warm runs in the same page. Prints wall time, ratio to the media duration,
 * the per-stage breakdown (User Timing measures `openroll:audio:*`), main-thread long tasks and
 * the progress curve (fraction vs time, stage labels). Nothing is written into the repo.
 */
import { chromium, expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScore, type Note } from '../../../src/core/score';
import { devTwoHand } from '../../../tests/fixtures/audio-devset';
import { noteF1 } from '../../../tests/roundtrip/metrics';
import { synthesizeScore } from '../../../tests/roundtrip/synth';

const { Midi } = createRequire(import.meta.url)('@tonejs/midi') as typeof import('@tonejs/midi');
const OUT_DIR = join(tmpdir(), 'openroll-real-check');

const RECORDING = process.env.REAL_RECORDING ?? join(homedir(), 'Downloads', 'recording.mov');
const RUNS = Number(process.env.RC_RUNS ?? 3);
/** Duration of REAL_RECORDING in seconds (for the ratio); default is recording.mov's. */
const REAL_SECONDS = Number(process.env.REAL_SECONDS ?? 24.15);
/** Length of the synthetic WAV (default 60 s; any other value tests a never-seen audio length). */
const WAV_SECONDS = Number(process.env.RC_WAV_SECONDS ?? 60);

/** Reference notes of the synthetic WAV (to score the transcription). */
let wavReference: Note[] = [];

/** 60 s two-hand piece: seeded dev-style pieces back to back, 44.1 kHz stereo 16-bit WAV. */
function sixtySecondWav(): string {
  const path = join(OUT_DIR, `two-hand-${WAV_SECONDS}s.wav`);
  const notes: Note[] = [];
  let offset = 0;
  for (let seed = 301; offset < WAV_SECONDS; seed++) {
    const piece = devTwoHand(seed);
    for (const n of piece.notes) if (offset + n.start < WAV_SECONDS - 0.5) notes.push({ ...n, start: offset + n.start });
    offset += piece.notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0) + 0.5;
  }
  wavReference = notes;
  if (existsSync(path)) return path;
  wavReference = notes;
  const sr = 44100;
  const mono = synthesizeScore(createScore({ notes }), { sampleRate: sr, seed: 7, tail: 0 }).subarray(0, Math.round(WAV_SECONDS * sr));
  const n = mono.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.max(-1, Math.min(1, mono[i]!)) * 32767);
    buf.writeInt16LE(v, 44 + i * 4);
    buf.writeInt16LE(v, 46 + i * 4);
  }
  mkdirSync(join(tmpdir(), 'openroll-real-check'), { recursive: true });
  writeFileSync(path, buf);
  return path;
}

/** Installed before the app: records long tasks and every change of the progress bar. */
const INIT = () => {
  const w = window as unknown as {
    __longtasks: { start: number; duration: number }[];
    __progress: { t: number; v: number; label: string }[];
  };
  w.__longtasks = [];
  w.__progress = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__longtasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    /* no long-task API */
  }
  let last = '';
  const tick = () => {
    const el = document.querySelector<HTMLProgressElement>('[data-testid="convert-progress"]');
    if (el) {
      const label = el.parentElement?.textContent ?? '';
      const key = `${el.value}|${label}`;
      if (key !== last) {
        last = key;
        // Keep the stage word only (drop file name, percentage and the UI's ETA text).
        const stage = (/·\s*([^·]*?)(?:about|estimating|Cancel|$)/.exec(label)?.[1] ?? '').trim();
        w.__progress.push({ t: performance.now(), v: el.value, label: stage });
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

interface RunResult {
  wallMs: number;
  stages: Record<string, number>;
  backend: string;
  longTasks: { start: number; duration: number }[];
  spans: { stage: string; start: number; end: number }[];
  progress: { t: number; v: number; label: string }[];
}

async function convertOnce(page: Page, path: string, video: boolean, check?: string): Promise<RunResult> {
  await page.evaluate(() => {
    performance.clearMeasures();
    const w = window as unknown as { __longtasks: unknown[]; __progress: unknown[]; __t0: number };
    w.__longtasks.length = 0;
    w.__progress.length = 0;
    w.__t0 = performance.now();
  });
  await page.getByTestId('file-input').setInputFiles(path);
  if (video) await page.getByRole('button', { name: 'Real performance' }).click();
  await expect(page.getByTestId('score-summary')).toBeVisible({ timeout: 300_000 });
  const r = await page.evaluate(() => {
    const w = window as unknown as {
      __longtasks: { start: number; duration: number }[];
      __progress: { t: number; v: number; label: string }[];
      __t0: number;
    };
    const stages: Record<string, number> = {};
    const spans: { stage: string; start: number; end: number }[] = [];
    let backend = '';
    for (const m of performance.getEntriesByType('measure') as PerformanceMeasure[]) {
      if (!m.name.startsWith('openroll:audio:')) continue;
      const k = m.name.slice('openroll:audio:'.length);
      stages[k] = (stages[k] ?? 0) + m.duration;
      spans.push({ stage: k, start: Math.round(m.startTime - w.__t0), end: Math.round(m.startTime + m.duration - w.__t0) });
      const d = m.detail as { backend?: string; programs?: number } | null;
      if (d?.backend) backend = d.backend + (d.programs ? ` (${d.programs} GPU programs)` : '');
    }
    const end = w.__progress.length ? w.__progress[w.__progress.length - 1]!.t : performance.now();
    return {
      wallMs: end - w.__t0,
      stages,
      backend,
      spans,
      longTasks: w.__longtasks
        .filter((l) => l.start + l.duration >= w.__t0)
        .map((l) => ({ start: Math.round(l.start - w.__t0), duration: Math.round(l.duration) })),
      progress: w.__progress.map((p) => ({ ...p, t: p.t - w.__t0 })),
    };
  });
  // The result screen replaces the progress bar; wall time = until the summary is shown.
  r.wallMs = await page.evaluate(() => performance.now() - (window as unknown as { __t0: number }).__t0);
  if (check) await checkNotes(page, check);
  await page.getByRole('button', { name: 'OpenRoll' }).click();
  return r;
}

function fmt(name: string, seconds: number, i: number, r: RunResult): string {
  const order = ['file-read', 'decode', 'resample', 'downmix', 'wait-model', 'backend', 'model-load', 'warmup', 'inference', 'decode-notes', 'postprocess', 'total'];
  const st = order.filter((k) => r.stages[k] !== undefined).map((k) => `${k} ${Math.round(r.stages[k]!)}`).join(' · ');
  const lt = r.longTasks.length
    ? `${r.longTasks.map((l) => `${l.duration} ms @${l.start}`).join(', ')} (${r.longTasks.filter((x) => x.duration > 100).length} > 100 ms)`
    : 'none';
  return (
    `[speed] ${name} run ${i + 1} (${i === 0 ? 'cold' : 'warm'}): ${(r.wallMs / 1000).toFixed(2)} s = ${(r.wallMs / 1000 / seconds).toFixed(3)}× duration` +
    ` | backend ${r.backend || '?'}\n[speed]   stages ms: ${st}\n[speed]   main-thread long tasks: ${lt}`
  );
}

function progressShape(r: RunResult): string {
  // Fraction vs. elapsed share of the wall time at 10 % steps of time, plus stage labels seen.
  const pts: string[] = [];
  for (let k = 1; k <= 10; k++) {
    const t = (r.wallMs * k) / 10;
    const p = [...r.progress].reverse().find((x) => x.t <= t);
    pts.push(`${k * 10}%→${p ? Math.round(p.v * 100) : 0}`);
  }
  const labels = [...new Set(r.progress.map((p) => p.label))].join(' > ');
  let monotonic = true;
  for (let i = 1; i < r.progress.length; i++) if (r.progress[i]!.v < r.progress[i - 1]!.v) monotonic = false;
  return `[speed]   progress (time→fraction): ${pts.join(' ')} | monotonic ${monotonic} | labels: ${labels}`;
}

/**
 * Downloads the MIDI of the current result, prints the note count and (for the synthetic WAV)
 * note F1 against the reference; saves the notes so backends/builds can be compared.
 */
async function checkNotes(page: Page, name: string): Promise<void> {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('tab', { name: 'Download' }).click();
      await page.getByTestId('download-midi').click();
    })(),
  ]);
  const midi = new Midi(readFileSync(await dl.path()));
  const notes = midi.tracks.flatMap((t) => t.notes.map((n) => ({ pitch: n.midi, start: n.time })));
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const tag = process.env.RC_TAG ?? 'run';
  writeFileSync(join(OUT_DIR, `notes-${tag}-${name.replace(/\W+/g, '_')}.json`), JSON.stringify(notes));
  let line = `[speed]   notes: ${notes.length}`;
  if (name.includes('WAV') && wavReference.length) {
    const m = noteF1(wavReference, notes, 0.05);
    line += ` | F1 vs reference ${(m.f1 * 100).toFixed(1)}% (P ${(m.precision * 100).toFixed(1)}, R ${(m.recall * 100).toFixed(1)})`;
  }
  console.log(line);
}

test.describe.configure({ mode: 'serial' });

const SCENARIOS: { name: string; path: () => string; seconds: number; video: boolean }[] = [
  {
    name: `${RECORDING.split('/').pop()} (${REAL_SECONDS} s)`,
    path: () => RECORDING,
    seconds: REAL_SECONDS,
    video: true,
  },
  { name: `${WAV_SECONDS} s two-hand WAV`, path: sixtySecondWav, seconds: WAV_SECONDS, video: false },
];

for (const s of SCENARIOS) {
  test(`speed: ${s.name}`, async ({ baseURL }) => {
    const path = s.path();
    test.skip(!existsSync(path), `missing ${path}`);
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      const page = await browser.newPage();
      await page.addInitScript(INIT);
      await page.goto(`${baseURL}/?lang=en`);
      for (let i = 0; i < RUNS; i++) {
        const r = await convertOnce(page, path, s.video, i === 0 ? s.name : undefined);
        console.log(fmt(s.name, s.seconds, i, r));
        console.log(progressShape(r));
        if (process.env.RC_PROGRESS === '1') console.log(JSON.stringify({ progress: r.progress, spans: r.spans }));
      }
    } finally {
      await browser.close();
    }
  });
}
