/**
 * Note-level transcription metrics shared by the round-trip tests (audio, falling-notes video).
 * A reference note and an estimated note match when the pitch is exactly equal and the onsets
 * differ by at most `onsetTolerance` seconds (offsets ignored, like mir_eval's onset-only F1).
 * Matching is a maximum bipartite matching per pitch, so one estimate can match one reference.
 */

export interface TimedPitch {
  pitch: number;
  start: number;
}

export interface NoteMetrics {
  precision: number;
  recall: number;
  f1: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** Mean |onset error| over matched notes, seconds. */
  meanOnsetError: number;
  /** Unmatched references (misses) and unmatched estimates (extras), for diagnostics. */
  missed: TimedPitch[];
  extra: TimedPitch[];
}

export function noteF1(reference: TimedPitch[], estimate: TimedPitch[], onsetTolerance = 0.05): NoteMetrics {
  const pitches = new Set([...reference.map((n) => n.pitch), ...estimate.map((n) => n.pitch)]);
  let tp = 0;
  let errSum = 0;
  const missed: TimedPitch[] = [];
  const extra: TimedPitch[] = [];

  for (const p of pitches) {
    const ref = reference.filter((n) => n.pitch === p);
    const est = estimate.filter((n) => n.pitch === p);
    // Candidate edges: ref i ↔ est j within tolerance.
    const adj = ref.map((r) =>
      est.map((e, j) => (Math.abs(e.start - r.start) <= onsetTolerance + 1e-9 ? j : -1)).filter((j) => j >= 0),
    );
    const matchOfEst = new Array<number>(est.length).fill(-1);
    const tryAugment = (i: number, seen: boolean[]): boolean => {
      for (const j of adj[i]!) {
        if (seen[j]) continue;
        seen[j] = true;
        if (matchOfEst[j] === -1 || tryAugment(matchOfEst[j]!, seen)) {
          matchOfEst[j] = i;
          return true;
        }
      }
      return false;
    };
    for (let i = 0; i < ref.length; i++) tryAugment(i, new Array<boolean>(est.length).fill(false));

    const refMatched = new Array<boolean>(ref.length).fill(false);
    matchOfEst.forEach((i, j) => {
      if (i >= 0) {
        tp++;
        refMatched[i] = true;
        errSum += Math.abs(est[j]!.start - ref[i]!.start);
      } else {
        extra.push({ pitch: p, start: est[j]!.start });
      }
    });
    ref.forEach((r, i) => {
      if (!refMatched[i]) missed.push({ pitch: p, start: r.start });
    });
  }

  const fp = estimate.length - tp;
  const fn = reference.length - tp;
  const precision = estimate.length ? tp / estimate.length : reference.length ? 0 : 1;
  const recall = reference.length ? tp / reference.length : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const byTime = (a: TimedPitch, b: TimedPitch) => a.start - b.start || a.pitch - b.pitch;
  return {
    precision,
    recall,
    f1,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    meanOnsetError: tp ? errSum / tp : 0,
    missed: missed.sort(byTime),
    extra: extra.sort(byTime),
  };
}

export function formatMetrics(name: string, m: NoteMetrics): string {
  const pct = (x: number) => (x * 100).toFixed(1).padStart(5) + '%';
  return (
    `${name}: F1 ${pct(m.f1)} | precision ${pct(m.precision)} | recall ${pct(m.recall)} | ` +
    `TP ${m.truePositives} FP ${m.falsePositives} FN ${m.falseNegatives} | ` +
    `mean onset error ${(m.meanOnsetError * 1000).toFixed(1)} ms`
  );
}

/**
 * Prints a line that stays visible in the default Vitest reporter, which hides console.* output
 * of passing tests. Accuracy numbers must always be seen, pass or fail.
 */
export function report(line: string): void {
  process.stdout.write(line + '\n');
}
