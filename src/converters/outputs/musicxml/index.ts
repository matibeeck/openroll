import type { Score } from '../../../core/score';
import type { OutputConverter } from '../../types';
import { scoreToMusicXml, type ScoreToMusicXmlOptions } from './scoreToMusicXml';

export { scoreToMusicXml, quantizedToMusicXml, type ScoreToMusicXmlOptions } from './scoreToMusicXml';

export const MUSICXML_MIME = 'application/vnd.recordare.musicxml+xml';

export const musicXmlOutput: OutputConverter<ScoreToMusicXmlOptions> = {
  id: 'musicxml-file',
  label: 'MusicXML file',
  kind: 'file',
  async export(score: Score, opts: ScoreToMusicXmlOptions): Promise<Blob> {
    return new Blob([scoreToMusicXml(score, opts)], { type: MUSICXML_MIME });
  },
};
