import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { minuetInG, pieceToMusicXml } from '../fixtures/music';
import { openFile, settledScreenshot, writeTemp } from './helpers';

test('MusicXML → sheet music, then MIDI and MusicXML downloads', async ({ page }) => {
  await page.goto('/?lang=en');
  await openFile(page, writeTemp('minuet.musicxml', pieceToMusicXml(minuetInG)));
  await expect(page.getByTestId('score-title')).toHaveText('Minuet in G (BWV Anh. 114)');

  await page.getByRole('tab', { name: 'Sheet' }).click();
  const sheet = page.getByTestId('sheet');
  await expect(sheet.locator('svg').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('sheet-page')).toHaveText(/^Page 1 \/ \d+$/);
  // Notated input has a fixed beat: no tempo/time-signature controls.
  await expect(page.getByTestId('sheet-bpm')).toHaveCount(0);
  const noteCount = await sheet.locator('g.note').count();
  console.log(`sheet: ${noteCount} notes engraved on page 1`);
  expect(noteCount).toBeGreaterThan(20);
  await settledScreenshot(page, 'docs/screenshots/sheet.png', { fullPage: true });

  await page.getByRole('tab', { name: 'Download' }).click();
  const [xmlDownload] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-musicxml').click()]);
  expect(xmlDownload.suggestedFilename()).toBe('Minuet-in-G-BWV-Anh-114.musicxml');
  const xml = readFileSync((await xmlDownload.path())!, 'utf8');
  expect(xml).toContain('<score-partwise version="4.0">');
  expect((xml.match(/<note>/g) ?? []).length).toBeGreaterThanOrEqual(97);

  const [midiDownload] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-midi').click()]);
  expect(midiDownload.suggestedFilename()).toBe('Minuet-in-G-BWV-Anh-114.mid');
  const midi = readFileSync((await midiDownload.path())!);
  expect(midi.subarray(0, 4).toString('latin1')).toBe('MThd');
});
