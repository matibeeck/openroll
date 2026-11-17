/** Input type detection from file name / MIME type. Videos are ambiguous and need a user choice. */
export type InputKind = 'midi' | 'musicxml' | 'audio' | 'video' | 'unknown';

const EXT: Record<string, InputKind> = {
  mid: 'midi', midi: 'midi', kar: 'midi',
  musicxml: 'musicxml', xml: 'musicxml', mxl: 'musicxml',
  mp3: 'audio', wav: 'audio', ogg: 'audio', oga: 'audio', flac: 'audio', m4a: 'audio', aac: 'audio', opus: 'audio',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', mkv: 'video',
};

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

export function detectKind(name: string, mime = ''): InputKind {
  const byExt = EXT[extensionOf(name)];
  if (byExt) return byExt;
  if (mime.includes('midi')) return 'midi';
  if (mime.includes('musicxml')) return 'musicxml';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'unknown';
}

/** Converter id for a kind; videos require the user's answer. */
export function converterIdFor(kind: InputKind, videoMode?: 'falling-notes' | 'performance'): string | null {
  switch (kind) {
    case 'midi':
      return 'midi';
    case 'musicxml':
      return 'musicxml';
    case 'audio':
      return 'audio';
    case 'video':
      return videoMode === 'falling-notes' ? 'falling-notes-video' : videoMode === 'performance' ? 'performance-video' : null;
    default:
      return null;
  }
}
