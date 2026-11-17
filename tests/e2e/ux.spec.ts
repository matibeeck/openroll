import { expect, test, type Page } from '@playwright/test';
import { openFile, settledScreenshot, synthWav, writeTemp } from './helpers';

/** Records every interaction's latency (input → next paint) with the Event Timing API. */
async function trackInteractions(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __events: { name: string; duration: number }[] };
    w.__events = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceEventTiming[]) {
        if (e.interactionId) w.__events.push({ name: e.name, duration: Math.round(e.duration) });
      }
    }).observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit);
  });
}
const slowest = (page: Page) =>
  page.evaluate(() => (window as unknown as { __events: { name: string; duration: number }[] }).__events);

test('example piece, space bar, repeat section and responsive interactions', async ({ page }) => {
  await trackInteractions(page);
  await page.goto('/?lang=en');
  await page.getByTestId('demo').click();
  await expect(page.getByTestId('score-title')).toHaveText('Ode to Joy (Beethoven)');
  await page.waitForTimeout(800); // idle piano warm-up
  await settledScreenshot(page, 'docs/screenshots/example-practice.png');

  // Space bar plays and pauses.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Space');
  await expect(page.getByTestId('play')).toHaveText('Pause');
  await page.waitForTimeout(2200);
  await page.keyboard.press('Space');
  await expect(page.getByTestId('play')).toHaveText('Play');

  // Repeat section: renamed buttons with an explanatory tooltip, band drawn on the seek bar.
  const start = page.getByRole('button', { name: /^Repeat: start/ });
  await expect(start).toHaveAttribute('title', /jumps back to the start/);
  await start.click();
  await page.keyboard.press('Space');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /^Repeat: end/ }).click();
  await page.keyboard.press('Space');
  const band = page.getByTestId('loop-band');
  await expect(band).toBeVisible();
  await expect(page.getByRole('button', { name: /^Repeat: end \d:\d\d/ })).toBeVisible();
  const box = (await band.boundingBox())!;
  const bar = (await page.getByLabel('Position').boundingBox())!;
  expect(box.width).toBeGreaterThan(4);
  expect(box.width).toBeLessThan(bar.width * 0.5); // only the marked section, not the whole bar
  await settledScreenshot(page, 'docs/screenshots/repeat-section.png');
  await page.getByRole('button', { name: 'Clear repeat' }).click();
  await expect(band).toHaveCount(0);

  // Tabs, speed and settings.
  for (const tab of ['Sheet', 'Video', 'Download', 'Practice']) {
    await page.getByRole('tab', { name: tab }).click();
    if (tab === 'Sheet') {
      await expect(page.getByTestId('sheet').locator('svg').first()).toBeVisible({ timeout: 30_000 });
      await settledScreenshot(page, 'docs/screenshots/example-sheet.png', { fullPage: true });
    }
    if (tab === 'Video') await expect(page.getByTestId('video-live-preview')).toBeVisible();
  }
  await page.getByLabel('Speed').fill('0.5');
  await page.getByLabel('Wait mode').check();

  const events = await slowest(page);
  const worst = events.reduce((m, e) => Math.max(m, e.duration), 0);
  console.log(`[ux] ${events.length} slow-ish interactions (>16 ms), worst ${worst} ms:`, JSON.stringify(events));
  expect(worst).toBeLessThan(100);
});

test('mobile practice view paints (no black canvas after resize)', async ({ page }) => {
  await page.goto('/?lang=en');
  await page.getByTestId('demo').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const lit = await page.getByTestId('practice-canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, c.height - 10, c.width, 1).data;
    let bright = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! > 200) bright++;
    return bright / (d.length / 4);
  });
  expect(lit).toBeGreaterThan(0.5); // white keys visible along the bottom row
  await settledScreenshot(page, 'docs/screenshots/mobile-practice.png', { fullPage: true });
});

test('conversion shows the stage in the UI language and a time estimate', async ({ page }) => {
  const melody = Array.from({ length: 60 }, (_, i) => [55 + ((i * 7) % 17), 0.25 + i * 0.3, 0.28] as [number, number, number]);
  await page.goto('/?lang=es');
  await openFile(page, writeTemp('eta.wav', synthWav(melody)), 'fast');
  await expect(page.getByTestId('convert-eta')).toHaveText(/calculando|quedan/);
  await expect(page.getByTestId('convert-status')).not.toContainText(/transcribing|decoding|reading/);
  await settledScreenshot(page, 'docs/screenshots/converting.png');
  await expect(page.getByTestId('score-summary')).toBeVisible({ timeout: 90_000 });
});
