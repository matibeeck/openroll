import { expect, test } from '@playwright/test';
import { generatedMidi, openFile, writeTemp } from './helpers';

test('video export: 10-second clip plays and has the right duration', async ({ page }) => {
  await page.goto('/?lang=en&clip=10');
  await openFile(page, writeTemp('clip.mid', generatedMidi(14, 'Clip test')));
  await page.getByRole('tab', { name: 'Video' }).click();
  await page.getByTestId('export-video').click();
  const preview = page.getByTestId('video-preview');
  await expect(preview).toBeVisible({ timeout: 60_000 });
  const info = await preview.evaluate(async (v: HTMLVideoElement) => {
    // MediaRecorder WebM may lack a duration header: seek far to force it to be computed.
    if (v.readyState < 1) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
    if (!Number.isFinite(v.duration)) {
      v.currentTime = 1e6;
      await new Promise((r) => v.addEventListener('durationchange', r, { once: true }));
    }
    const duration = v.duration;
    v.currentTime = 0;
    v.muted = true;
    await v.play();
    await new Promise((r) => setTimeout(r, 700));
    const played = v.currentTime;
    v.pause();
    const blob = await (await fetch(v.src)).blob();
    return { duration, played, type: blob.type, size: blob.size, w: v.videoWidth, h: v.videoHeight };
  });
  console.log('exported clip', info);
  expect(info.type).toBe('video/webm');
  expect(info.size).toBeGreaterThan(10_000);
  expect(info.w).toBe(1280);
  expect(info.h).toBe(720);
  expect(info.played).toBeGreaterThan(0.2);
  expect(Math.abs(info.duration - 10)).toBeLessThanOrEqual(0.2);
  await page.screenshot({ path: 'docs/screenshots/video-export.png' });
});
