import { expect, test } from '@playwright/test';

test('PWA: manifest is installable and the app works offline after the first load', async ({ page, context }) => {
  await page.goto('/?lang=en');
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')?.getAttribute('href');
    return href ? (await fetch(href)).json() : null;
  });
  expect(manifest?.name).toBe('OpenRoll');
  expect(manifest?.icons?.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Wait until the service worker controls the page (autoUpdate + clientsClaim).
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'OpenRoll' })).toBeVisible();
  await expect(page.getByTestId('dropzone')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/home-offline.png' });
  await context.setOffline(false);
});
