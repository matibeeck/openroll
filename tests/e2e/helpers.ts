import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Page } from '@playwright/test';

// @tonejs/midi is CommonJS; Playwright's ESM loader needs require().
const { Midi } = createRequire(import.meta.url)('@tonejs/midi') as typeof import('@tonejs/midi');

/** Generated two-hand piece: right-hand arpeggios over left-hand bass notes, `seconds` long at 120 BPM. */
export function generatedMidi(seconds: number, title = 'Generated etude'): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(120);
  midi.header.name = title;
  const rh = midi.addTrack();
  rh.name = 'Right hand';
  const lh = midi.addTrack();
  lh.name = 'Left hand';
  const chords = [
    [60, 64, 67, 72],
    [57, 60, 64, 69],
    [53, 57, 60, 65],
    [55, 59, 62, 67],
  ];
  for (let bar = 0; bar * 2 < seconds; bar++) {
    const ch = chords[bar % chords.length]!;
    for (let i = 0; i < 8; i++) {
      const time = bar * 2 + i * 0.25;
      if (time >= seconds) break;
      rh.addNote({ midi: ch[i % 4]! + (i >= 4 ? 12 : 0), time, duration: 0.24, velocity: 0.7 });
    }
    if (bar * 2 < seconds) lh.addNote({ midi: ch[0]! - 24, time: bar * 2, duration: 1.9, velocity: 0.6 });
  }
  return midi.toArray();
}

export function writeTemp(name: string, data: Uint8Array | string): string {
  const dir = join(tmpdir(), 'openroll-e2e');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, data);
  return p;
}

export async function openFile(page: Page, path: string) {
  await page.getByTestId('file-input').setInputFiles(path);
}
