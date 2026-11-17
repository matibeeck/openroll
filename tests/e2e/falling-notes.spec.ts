import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { generatedMidi, openFile, writeTemp } from './helpers';
import { formatMetrics, noteF1, type TimedPitch } from '../roundtrip/metrics';

const { Midi } = createRequire(import.meta.url)('@tonejs/midi') as typeof import('@tonejs/midi');

function midiNotes(bytes: Uint8Array): TimedPitch[] {
  return new Midi(bytes).tracks.flatMap((t) => t.notes.map((n) => ({ pitch: n.midi, start: n.time })));
}

/** Best constant time shift (diagnostic): recorder start latency shows up as an offset. */
function bestOffset(ref: TimedPitch[], est: TimedPitch[]): { offset: number; f1: number } {
  let best = { offset: 0, f1: -1 };
  for (let ms = -150; ms <= 150; ms += 5) {
    const f1 = noteF1(ref, est.map((n) => ({ ...n, start: n.start + ms / 1000 })), 0.05).f1;
    if (f1 > best.f1) best = { offset: ms / 1000, f1 };
  }
  return best;
}

test('falling-notes video: M3 WebM export → recognizer → practice view', async ({ page }) => {
  test.setTimeout(240_000);
  const seconds = 6;
  const midiBytes = generatedMidi(seconds, 'Falling roundtrip');
  const reference = midiNotes(midiBytes).filter((n) => n.start < seconds);

  // 1. Export a WebM with the app's own exporter (MediaRecorder, real time).
  await page.goto(`/?lang=en&clip=${seconds}`);
  await openFile(page, writeTemp('falling-roundtrip.mid', midiBytes));
  await page.getByRole('tab', { name: 'Video' }).click();
  await page.getByTestId('export-video').click();
  const link = page.getByTestId('download-video');
  await expect(link).toBeVisible({ timeout: 90_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  const webmPath = writeTemp('falling-roundtrip.webm', new Uint8Array());
  await download.saveAs(webmPath);

  // 2. Load the WebM back as a falling-notes video.
  await page.getByRole('button', { name: 'Open another file' }).click();
  await openFile(page, webmPath);
  await page.getByRole('button', { name: 'Falling-notes video' }).click();
  const summary = page.getByTestId('score-summary');
  await expect(summary).toBeVisible({ timeout: 180_000 });
  const count = Number(/(\d+)/.exec((await summary.textContent()) ?? '')?.[1] ?? 0);
  await page.screenshot({ path: 'docs/screenshots/falling-notes.png' });

  // 3. Note F1 through the Download tab's MIDI file.
  await page.getByRole('tab', { name: 'Download' }).click();
  const [midiDl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-midi').click()]);
  const estimate = midiNotes(new Uint8Array(readFileSync((await midiDl.path())!)));
  const m = noteF1(reference, estimate, 0.05);
  const shift = bestOffset(reference, estimate);
  console.log(
    `[falling-notes e2e] encoded WebM: ${formatMetrics('M3 export → recognizer', m)} | ` +
      `reference ${reference.length} notes, detected ${count} | best constant shift ${(shift.offset * 1000).toFixed(0)} ms → F1 ${(shift.f1 * 100).toFixed(1)}%`,
  );
  if (m.missed.length) console.log(`[falling-notes e2e]   missed: ${m.missed.map((x) => `${x.pitch}@${x.start.toFixed(2)}`).join(' ')}`);
  if (m.extra.length) console.log(`[falling-notes e2e]   extra:  ${m.extra.map((x) => `${x.pitch}@${x.start.toFixed(2)}`).join(' ')}`);

  expect(estimate.length).toBe(count);
  expect(Math.abs(count - reference.length)).toBeLessThanOrEqual(Math.ceil(reference.length * 0.1));
  expect(m.f1).toBeGreaterThanOrEqual(0.95);

  // 4. Manual calibration from the result screen: the dialog opens with the auto values; accepting them gives the same notes.
  await page.getByRole('button', { name: 'Recalibrate keyboard' }).click();
  await expect(page.getByTestId('calibration-dialog')).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: 'docs/screenshots/calibration.png' });
  await page.getByTestId('calibrate-ok').click();
  await expect(page.getByTestId('score-summary')).toContainText(`${count} notes`, { timeout: 180_000 });
});
