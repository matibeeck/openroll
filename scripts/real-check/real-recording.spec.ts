import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Real-recording sheet check (not part of `npm run test:e2e`): the recording stays on the user's
// machine and is never copied into the repo. Uses real Chrome because Playwright's bundled
// Chromium may lack AAC.
// Run: npm run real-check:sheet   (config: scripts/real-check/sheet.config.ts, port 4191)
// REAL_RECORDING=/path/file.mov picks another file; SHOT=name the screenshot name
// (default docs/screenshots/real-recording-sheet.png). Prints meter, key, tempo, rests per staff-bar
// and asserts meter 6/8, key F major (−1), no sharps, ≤ 1 rest per staff-bar (REAL_EXPECT changes the first two).
const file = process.env.REAL_RECORDING ?? join(homedir(), 'Downloads', 'recording.mov');
const shot = process.env.SHOT ?? 'real-recording-sheet';

test.skip(!existsSync(file), `recording not found: ${file}`);

/** Readability numbers of a two-staff MusicXML file. */
function sheetStats(xml: string) {
  const measures = (xml.match(/<measure\b/g) ?? []).length;
  const staves = Number(/<staves>(\d+)<\/staves>/.exec(xml)?.[1] ?? 1);
  const rests = (xml.match(/<rest\b/g) ?? []).length;
  const notes = (xml.match(/<note\b/g) ?? []).length - rests;
  return {
    time: `${/<beats>(\d+)<\/beats>/.exec(xml)?.[1]}/${/<beat-type>(\d+)<\/beat-type>/.exec(xml)?.[1]}`,
    fifths: Number(/<fifths>(-?\d+)<\/fifths>/.exec(xml)?.[1]),
    tempo: Number(/<sound tempo="([\d.]+)"/.exec(xml)?.[1]),
    measures,
    notes,
    rests,
    restsPerStaffBar: +(rests / Math.max(1, measures * staves)).toFixed(2),
    tiesStart: (xml.match(/<tie type="start"/g) ?? []).length,
    sharps: (xml.match(/<alter>1<\/alter>/g) ?? []).length,
    flats: (xml.match(/<alter>-1<\/alter>/g) ?? []).length,
    /** Accidentals printed on the page (not covered by the key signature). */
    accidentals: (xml.match(/<accidental>/g) ?? []).length,
  };
}

test('real recording → sheet', async ({ page }) => {
  await page.goto('/?lang=en');
  await page.getByTestId('file-input').setInputFiles(file);
  await page.getByRole('button', { name: 'Real performance' }).click();
  await expect(page.getByTestId('score-summary')).toBeVisible({ timeout: 240_000 });
  console.log('summary:', await page.getByTestId('score-summary').innerText());
  await page.getByRole('tab', { name: 'Sheet' }).click();
  const sheet = page.getByTestId('sheet');
  await expect(sheet.locator('svg').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1000);
  const bpm = page.getByTestId('sheet-bpm');
  if (await bpm.count()) console.log('sheet controls: bpm', await bpm.inputValue(), 'meter', await page.getByTestId('sheet-timesig').inputValue());
  await page.screenshot({ path: `docs/screenshots/${shot}.png`, fullPage: true });

  await page.getByRole('tab', { name: 'Download' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-musicxml').click()]);
  const xml = readFileSync(await dl.path(), 'utf8');
  const stats = sheetStats(xml);
  console.log('stats:', JSON.stringify(stats));
  // the real recording is the F-major second theme of Chopin's Ballade No. 3 over a C pedal (6/8).
  // Override with REAL_EXPECT='time,fifths' for another file, e.g. REAL_EXPECT='4/4,0'.
  const [time, fifths] = (process.env.REAL_EXPECT ?? '6/8,-1').split(',');
  expect(stats.time).toBe(time);
  expect(stats.fifths).toBe(Number(fifths));
  expect(stats.sharps).toBe(0);
  expect(stats.restsPerStaffBar).toBeLessThanOrEqual(1.0);
});
