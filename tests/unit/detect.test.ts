import { describe, expect, it } from 'vitest';
import { converterIdFor, detectKind } from '../../src/converters/detect';

describe('detectKind', () => {
  it.each([
    ['song.MID', 'midi'],
    ['score.musicxml', 'musicxml'],
    ['score.mxl', 'musicxml'],
    ['take.flac', 'audio'],
    ['take.m4a', 'audio'],
    ['clip.MOV', 'video'],
    ['clip.webm', 'video'],
    ['notes.txt', 'unknown'],
  ])('%s → %s', (name, kind) => expect(detectKind(name)).toBe(kind));

  it('falls back to MIME type', () => {
    expect(detectKind('blob', 'audio/x-wav')).toBe('audio');
    expect(detectKind('blob', 'video/mp4')).toBe('video');
  });

  it('videos need a mode', () => {
    expect(converterIdFor('video')).toBeNull();
    expect(converterIdFor('video', 'falling-notes')).toBe('falling-notes-video');
    expect(converterIdFor('video', 'performance')).toBe('performance-video');
  });
});
