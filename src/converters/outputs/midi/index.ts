import type { Score } from '../../../core/score';
import type { OutputConverter } from '../../types';
import { scoreToMidiBytes, type ScoreToMidiOptions } from './scoreToMidi';

export { scoreToMidiBytes, type ScoreToMidiOptions } from './scoreToMidi';

export const midiOutput: OutputConverter<ScoreToMidiOptions> = {
  id: 'midi-file',
  label: 'MIDI file',
  kind: 'file',
  async export(score: Score, opts: ScoreToMidiOptions): Promise<Blob> {
    const bytes = scoreToMidiBytes(score, opts);
    return new Blob([bytes.slice().buffer], { type: 'audio/midi' });
  },
};
