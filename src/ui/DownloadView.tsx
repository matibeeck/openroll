import type { Score } from '../core/score';

/** Placeholder until M6 (MIDI / MusicXML downloads). */
export default function DownloadView({ score }: { score: Score }) {
  return <p>{score.notes.length}</p>;
}
