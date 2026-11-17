import type { Score } from '../core/score';

/** Placeholder until M6 (sheet music rendering with Verovio). */
export default function SheetView({ score }: { score: Score }) {
  return <p>{score.notes.length}</p>;
}
