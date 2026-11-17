import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { generatedMidi, openFile, writeTemp } from './helpers';

test('MIDI → practice: 5-minute piece plays smoothly; keyboard input is scored', async ({ page }) => {
  await page.goto('/?lang=en');
  await openFile(page, writeTemp('five-minutes.mid', generatedMidi(300, 'Five minute etude')));
  await expect(page.getByTestId('score-title')).toHaveText('Five minute etude');
  await expect(page.getByTestId('score-summary')).toContainText('5:00');
  const canvas = page.getByTestId('practice-canvas');
  await expect(canvas).toBeVisible();

  await page.getByTestId('play').click();
  await page.waitForTimeout(6000);
  const fps = Number(await canvas.getAttribute('data-fps'));
  const renderMs = Number(await canvas.getAttribute('data-render-ms'));
  const worstRenderMs = Number(await canvas.getAttribute('data-worst-render-ms'));
  console.log(`practice (5-minute piece, headless Chromium): ${fps.toFixed(1)} fps, render ${renderMs} ms avg, ${worstRenderMs} ms worst`);
  writeFileSync(
    'docs/metrics/practice-fps.json',
    JSON.stringify(
      { fps, renderMsAvg: renderMs, renderMsWorst: worstRenderMs, piece: '300 s, 1350 notes, 2 hands', env: 'headless Chromium (rAF capped at 60 fps)', date: new Date().toISOString() },
      null,
      2,
    ),
  );
  expect(fps).toBeGreaterThan(50);
  // Frame budget at 60 fps is 16.7 ms; drawing must use a small part of it.
  expect(renderMs).toBeLessThan(8);
  await expect(page.getByTestId('time')).not.toHaveText(/^0:00 \//);
  await page.screenshot({ path: 'docs/screenshots/practice.png' });
  await page.getByTestId('play').click(); // pause

  // Wait mode + computer keyboard: the first note is C4 (key "a"), the bass C2 needs two octaves down.
  await page.getByRole('button', { name: 'Restart' }).click();
  await page.getByLabel('Wait mode').check();
  await page.getByTestId('play').click();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('time')).toHaveText(/^0:00 \//); // held at the first chord
  await page.keyboard.press('a'); // C4 → hit
  await page.keyboard.press('s'); // D4 → wrong
  await expect(page.getByTestId('stats')).toContainText('Hits 1');
  await expect(page.getByTestId('stats')).toContainText('Wrong 1');
  await expect(page.getByTestId('midi-status')).not.toBeEmpty();
});
