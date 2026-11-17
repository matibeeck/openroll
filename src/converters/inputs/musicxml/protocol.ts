import type { Score } from '../../../core/score';
import type { MusicXmlToScoreOptions } from './musicxmlToScore';

export interface MusicXmlRequest {
  id: number;
  bytes: Uint8Array;
  title?: string;
  opts: MusicXmlToScoreOptions;
}

export type MusicXmlResponse = { id: number; ok: true; score: Score } | { id: number; ok: false; error: string };
