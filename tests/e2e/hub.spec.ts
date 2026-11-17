import { expect, test } from '@playwright/test';
import { openFile, settledScreenshot, writeTemp } from './helpers';

/** Silent 1-second 16-bit mono WAV. */
function silentWav(): Uint8Array {
  const n = 22050;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(22050, 24);
  buf.writeUInt32LE(44100, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  return new Uint8Array(buf);
}

test('hub home in Spanish: drop zone, privacy notice, language switch', async ({ page }) => {
  await page.goto('/?lang=es');
  await expect(page.getByRole('heading', { name: 'Suelta lo que sea: MIDI, MusicXML, audio, video' })).toBeVisible();
  await expect(page.getByText('Todo se queda en tu dispositivo')).toBeVisible();
  await settledScreenshot(page, 'docs/screenshots/home-es.png');
  await page.getByLabel('Idioma').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Drop anything: MIDI, MusicXML, audio, video' })).toBeVisible();
  await expect(page.getByText('Everything stays on your device')).toBeVisible();
  await settledScreenshot(page, 'docs/screenshots/home.png');
});

test('unknown file types and undecodable audio show clear, translated errors', async ({ page }) => {
  await page.goto('/?lang=es');
  await openFile(page, writeTemp('notes.txt', 'hello'));
  await expect(page.getByRole('alert')).toContainText('Tipo de archivo no soportado: notes.txt');
  await openFile(page, writeTemp('silence.wav', silentWav()));
  await expect(page.getByRole('alert')).toContainText('silence.wav', { timeout: 60_000 });
  // The error comes from the converter's code, translated (not the English fallback message).
  const text = (await page.getByRole('alert').textContent()) ?? '';
  console.log('silent audio error:', text);
  expect(text).toMatch(/No se pudo convertir silence\.wav: .*silence\.wav/);
  expect(text).not.toMatch(/has no audible/);
});

test('videos ask whether they are falling-notes or a real performance', async ({ page }) => {
  await page.goto('/?lang=en');
  await openFile(page, writeTemp('clip.webm', new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])));
  await expect(page.getByRole('heading', { name: 'Is this a falling-notes video or a real performance?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Falling-notes video' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Real performance' })).toBeVisible();
  await settledScreenshot(page, 'docs/screenshots/video-question.png');
});
