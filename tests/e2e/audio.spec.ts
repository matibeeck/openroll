import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { openFile, synthWav, writeTemp } from './helpers';

const { Midi } = createRequire(import.meta.url)('@tonejs/midi') as typeof import('@tonejs/midi');

test('audio → notes → MIDI download', async ({ page }) => {
  // C major scale, 0.5 s per note.
  const scale = [60, 62, 64, 65, 67, 69, 71, 72];
  const wav = synthWav(scale.map((p, i) => [p, 0.25 + i * 0.5, 0.45] as [number, number, number]));
  await page.goto('/?lang=en');
  await openFile(page, writeTemp('scale.wav', wav));
  await expect(page.getByTestId('score-summary')).toBeVisible({ timeout: 90_000 });
  await page.screenshot({ path: 'docs/screenshots/audio-practice.png' });
  await page.getByRole('tab', { name: 'Download' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-midi').click()]);
  expect(download.suggestedFilename()).toMatch(/\.mid$/);
  const midi = new Midi(readFileSync(await download.path()));
  const pitches = midi.tracks.flatMap((t) => t.notes).sort((a, b) => a.time - b.time).map((n) => n.midi);
  console.log('transcribed pitches', pitches.join(' '));
  expect(pitches).toEqual(scale);
  await page.screenshot({ path: 'docs/screenshots/download.png' });
});

test('audio → sheet: tempo, tap tempo, time signature and zoom controls for free-timing input', async ({ page }) => {
  // 24 notes, 0.4 s apart (150 BPM eighth-ish), so the sheet spans several bars.
  const melody = Array.from({ length: 24 }, (_, i) => [60 + ((i * 5) % 13), 0.25 + i * 0.4, 0.35] as [number, number, number]);
  await page.goto('/?lang=en');
  await openFile(page, writeTemp('melody.wav', synthWav(melody)));
  await expect(page.getByTestId('score-summary')).toBeVisible({ timeout: 90_000 });
  await page.getByRole('tab', { name: 'Sheet' }).click();
  const sheet = page.getByTestId('sheet');
  await expect(sheet.locator('svg').first()).toBeVisible({ timeout: 30_000 });
  const bpm = page.getByTestId('sheet-bpm');
  await expect(bpm).toBeVisible(); // free timing → tempo controls shown

  const notesAt = async () => sheet.locator('g.note').count();
  const barsAt = async () => sheet.locator('g.measure').count();
  const bars120 = await barsAt();
  expect(await notesAt()).toBeGreaterThan(0);

  // Halving the tempo halves the number of beats → fewer bars.
  await bpm.fill('60');
  await expect.poll(barsAt, { timeout: 15_000 }).toBeLessThan(bars120);

  // Time signature 3/4 renders a 3/4 meter.
  await page.getByTestId('sheet-timesig').selectOption('3/4');
  await expect(sheet.locator('g.meterSig').first()).toBeVisible();
  await expect.poll(async () => (await sheet.innerHTML()).includes('meterSig'), { timeout: 15_000 }).toBe(true);

  // Tap tempo: 4 taps 500 ms apart → 120 BPM.
  for (let i = 0; i < 4; i++) {
    await page.getByTestId('sheet-tap').click();
    if (i < 3) await page.waitForTimeout(500);
  }
  await expect.poll(async () => Number(await bpm.inputValue()), { timeout: 5_000 }).toBeGreaterThan(105);
  expect(Number(await bpm.inputValue())).toBeLessThan(135);

  // Zoom changes the engraving size.
  const width = async () => (await sheet.locator('svg').first().boundingBox())?.height ?? 0;
  const before = await width();
  await page.getByTestId('sheet-zoom').fill('80');
  await expect.poll(width, { timeout: 15_000 }).not.toBe(before);
  await expect(page.getByTestId('sheet-page')).toContainText('1');
  await page.screenshot({ path: 'docs/screenshots/audio-sheet.png' });

  // The MusicXML download uses the chosen meter.
  await page.getByRole('tab', { name: 'Download' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-musicxml').click()]);
  const xml = readFileSync(await dl.path(), 'utf8');
  expect(xml).toContain('<beats>3</beats>');
});
