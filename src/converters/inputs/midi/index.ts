import type { Score } from '../../../core/score';
import type { InputConverter, ProgressFn } from '../../types';
import { isMidiBytes, midiBytesToScore, type MidiToScoreOptions } from './midiToScore';

export { midiBytesToScore, isMidiBytes, MidiParseError, type MidiToScoreOptions } from './midiToScore';

/** File name without its extension, used as a fallback title. */
export function titleFromFileName(name: string): string {
  return name.replace(/\.[^./\\]+$/, '').trim();
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Conversion cancelled', 'AbortError');
}

export const midiInput: InputConverter<MidiToScoreOptions> = {
  id: 'midi',
  label: 'MIDI',
  accepts: {
    extensions: ['.mid', '.midi', '.smf', '.kar'],
    mimeTypes: ['audio/midi', 'audio/mid', 'audio/x-midi', 'audio/sp-midi'],
  },
  async sniff(file: File): Promise<boolean> {
    return isMidiBytes(new Uint8Array(await file.slice(0, 14).arrayBuffer()));
  },
  async convert(file: File, opts: MidiToScoreOptions, onProgress: ProgressFn, signal: AbortSignal): Promise<Score> {
    throwIfAborted(signal);
    onProgress(0, 'reading');
    const bytes = new Uint8Array(await file.arrayBuffer());
    throwIfAborted(signal);
    const score = midiBytesToScore(bytes, titleFromFileName(file.name), opts);
    onProgress(1);
    return score;
  },
};
