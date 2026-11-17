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

/** 16-bit mono WAV of a piano-like tone per note: [midi pitch, start s, duration s]. */
export function synthWav(notes: [number, number, number][], sampleRate = 22050): Uint8Array {
  const end = Math.max(...notes.map(([, s, d]) => s + d)) + 0.5;
  const n = Math.ceil(end * sampleRate);
  const pcm = new Float32Array(n);
  for (const [pitch, start, dur] of notes) {
    const f = 440 * 2 ** ((pitch - 69) / 12);
    const s0 = Math.floor(start * sampleRate);
    const len = Math.floor((dur + 0.2) * sampleRate);
    for (let i = 0; i < len && s0 + i < n; i++) {
      const t = i / sampleRate;
      const env = Math.min(1, t / 0.005) * Math.exp(-3 * t) * (t > dur ? Math.exp(-(t - dur) * 25) : 1);
      let v = 0;
      for (let h = 1; h <= 4; h++) v += Math.sin(2 * Math.PI * f * h * t) / h ** 1.5;
      pcm[s0 + i]! += 0.25 * env * v;
    }
  }
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i]!)) * 32767), 44 + i * 2);
  return new Uint8Array(buf);
}
