import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createScore, type Note } from '../../src/core/score';
import { formatMetrics, noteF1 } from '../roundtrip/metrics';
import { synthesizeScore } from '../roundtrip/synth';
import { openFile, writeTemp } from './helpers';

const { Midi } = createRequire(import.meta.url)('@tonejs/midi') as typeof import('@tonejs/midi');

// The model is fetched at setup (scripts/fetch-transkun.mjs); without it the mode can only report "not installed".
const installed = existsSync(resolve('public/models/transkun/transkun.onnx'));

/** 16-bit mono WAV at 44.1 kHz of the round-trip piano synth (closer to a piano than the plain test tone). */
function pianoWav(notes: Note[]): Uint8Array {
  const sr = 44100;
  const pcm = synthesizeScore(createScore({ notes }), { sampleRate: sr, seed: 11 });
  const buf = Buffer.alloc(44 + pcm.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + pcm.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i]!)) * 32767), 44 + i * 2);
  return new Uint8Array(buf);
}

test('audio → high-precision (piano) mode → notes', async ({ page }) => {
  test.skip(!installed, 'Transkun model not installed: run node scripts/fetch-transkun.mjs');
  test.setTimeout(240_000);
  // C major scale, 0.5 s per note, then a C major chord.
  const scale = [60, 62, 64, 65, 67, 69, 71, 72];
  const notes: Note[] = scale.map((pitch, i) => ({ pitch, start: 0.25 + i * 0.5, duration: 0.45, velocity: 0.7, hand: null, track: 0 }));
  for (const pitch of [48, 52, 55]) notes.push({ pitch, start: 4.5, duration: 1.2, velocity: 0.6, hand: null, track: 0 });

  await page.goto('/?lang=en');
  await openFile(page, writeTemp('piano-scale.wav', pianoWav(notes)));
  await expect(page.getByTestId('mode-precise')).toBeVisible();
  await expect(page.getByTestId('mode-precise')).toContainText(/MB download the first time|already downloaded/);
  await page.screenshot({ path: 'docs/screenshots/mode-choice.png' });
  await page.getByTestId('mode-precise').click();
  // The progress screen shows a stage (download, model loading or listening) and an estimate.
  await expect(page.getByTestId('convert-status')).toBeVisible();
  await expect(page.getByTestId('score-summary')).toBeVisible({ timeout: 200_000 });
  const backend = await page.evaluate(
    () =>
      (performance.getEntriesByName('openroll:audio:total').at(-1) as PerformanceMeasure | undefined)?.detail?.backend as string | undefined,
  );

  await page.getByRole('tab', { name: 'Download' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-midi').click()]);
  const midi = new Midi(readFileSync(await download.path()));
  const got = midi.tracks
    .flatMap((t) => t.notes)
    .sort((a, b) => a.time - b.time || a.midi - b.midi)
    .map((n) => ({ pitch: n.midi, start: +n.time.toFixed(3) }));
  console.log(`high-precision notes (${backend ?? '?'}):`, JSON.stringify(got));
  // Same note-level metric as the round-trip tests; floor = PLAN.md M4's monophonic target. (Transkun is
  // trained on real pianos; on this additive synth it misses the top C, which the Node run of the same
  // audio, identical to upstream PyTorch, also misses.)
  const m = noteF1(notes, got, 0.05);
  console.log(formatMetrics('high-precision e2e scale + chord', m));
  expect(m.f1).toBeGreaterThanOrEqual(0.85);
});
