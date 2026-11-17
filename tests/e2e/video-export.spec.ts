import { expect, test } from '@playwright/test';
import { generatedMidi, openFile, synthWav, writeTemp } from './helpers';

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
    // The audio track must exist and not be silent.
    const audio = await new AudioContext().decodeAudioData(await blob.arrayBuffer());
    const ch = audio.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i]! * ch[i]!;
    const rms = Math.sqrt(sum / ch.length);
    return { duration, played, type: blob.type, size: blob.size, w: v.videoWidth, h: v.videoHeight, rms, audioDuration: audio.duration };
  });
  console.log('exported clip', info);
  expect(info.type).toBe('video/webm');
  expect(info.size).toBeGreaterThan(10_000);
  expect(info.w).toBe(1280);
  expect(info.h).toBe(720);
  expect(info.played).toBeGreaterThan(0.2);
  expect(Math.abs(info.duration - 10)).toBeLessThanOrEqual(0.2);
  expect(info.rms).toBeGreaterThan(0.005);
  await page.screenshot({ path: 'docs/screenshots/video-export.png' });
});

test('video export options: 1080p, 60 fps, light theme, labels', async ({ page }) => {
  await page.goto('/?lang=en&clip=2');
  await openFile(page, writeTemp('clip2.mid', generatedMidi(4, 'Options test')));
  await page.getByRole('tab', { name: 'Video' }).click();
  await page.getByLabel('Resolution').selectOption('1080');
  await page.getByLabel('Frame rate').selectOption('60');
  await page.getByLabel('Theme').selectOption('light');
  await page.getByLabel('Note names').check();
  await page.getByTestId('export-video').click();
  const preview = page.getByTestId('video-preview');
  await expect(preview).toBeVisible({ timeout: 60_000 });
  const info = await preview.evaluate(async (v: HTMLVideoElement) => {
    if (v.readyState < 2) await new Promise((r) => v.addEventListener('loadeddata', r, { once: true }));
    if (!Number.isFinite(v.duration)) {
      v.currentTime = 1e6;
      await new Promise((r) => v.addEventListener('durationchange', r, { once: true }));
    }
    const duration = v.duration;
    v.currentTime = 0.5;
    await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(v, 0, 0);
    const [r, g, b] = ctx.getImageData(5, 5, 1, 1).data; // background corner
    return { duration, w: v.videoWidth, h: v.videoHeight, bg: [r, g, b] };
  });
  console.log('options clip', info);
  expect(info.w).toBe(1920);
  expect(info.h).toBe(1080);
  expect(Math.abs(info.duration - 2)).toBeLessThanOrEqual(0.2);
  // Light theme background is #f1f5f9.
  expect(info.bg[0]).toBeGreaterThan(200);
});

test('video exported from a transcribed recording has audible sound', async ({ page }) => {
  const melody = Array.from({ length: 10 }, (_, i) => [60 + (i % 5) * 2, 0.25 + i * 0.4, 0.35] as [number, number, number]);
  await page.goto('/?lang=en&clip=4');
  await openFile(page, writeTemp('rec.wav', synthWav(melody)));
  await expect(page.getByTestId('score-summary')).toBeVisible({ timeout: 90_000 });
  await page.getByRole('tab', { name: 'Video' }).click();
  await page.getByTestId('export-video').click();
  const preview = page.getByTestId('video-preview');
  await expect(preview).toBeVisible({ timeout: 60_000 });
  const rms = await preview.evaluate(async (v: HTMLVideoElement) => {
    const blob = await (await fetch(v.src)).blob();
    const audio = await new AudioContext().decodeAudioData(await blob.arrayBuffer());
    const ch = audio.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i]! * ch[i]!;
    return Math.sqrt(sum / ch.length);
  });
  console.log('transcribed export RMS', rms);
  expect(rms).toBeGreaterThan(0.005);
});

test('export keeps sound and length when the tab is hidden (no animation frames)', async ({ page }) => {
  // Hidden tabs get no requestAnimationFrame callbacks; the exporter must not depend on them.
  await page.addInitScript(() => {
    window.requestAnimationFrame = () => 0;
  });
  await page.goto('/?lang=en&clip=4');
  await openFile(page, writeTemp('hidden.mid', generatedMidi(6, 'Hidden tab')));
  await page.getByRole('tab', { name: 'Video' }).click();
  await page.getByTestId('export-video').click();
  const preview = page.getByTestId('video-preview');
  await expect(preview).toBeVisible({ timeout: 60_000 });
  const info = await preview.evaluate(async (v: HTMLVideoElement) => {
    const blob = await (await fetch(v.src)).blob();
    const audio = await new AudioContext().decodeAudioData(await blob.arrayBuffer());
    const ch = audio.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i]! * ch[i]!;
    return { rms: Math.sqrt(sum / ch.length), duration: audio.duration };
  });
  console.log('hidden-tab export', info);
  expect(info.rms).toBeGreaterThan(0.005);
  expect(Math.abs(info.duration - 4)).toBeLessThanOrEqual(0.3);
});
