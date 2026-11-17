/**
 * Semi-CRF Viterbi decode of Transkun's interval scores, written from transkun 2.0.1
 * `CRF/NeuralSemiCRFInterval.viterbiBackward` (MIT, © 2021 Yujia Yan).
 *
 * `S` is the model output [T, T, K] row-major: S[e, b, k] scores a note on track k from frame b to
 * frame e (e ≥ b; e == b is a one-frame note). The "no event" score is 0. Tracks are independent.
 * Returns, per track, the decoded intervals [begin, end] in the order upstream emits them.
 */
export type Interval = [number, number];

export function viterbiBackward(
  S: Float32Array,
  T: number,
  K: number,
  forcedStartPos?: readonly number[],
): Interval[][] {
  const result: Interval[][] = Array.from({ length: K }, () => []);
  if (T <= 0) return result;
  const diag = (t: number, k: number) => S[(t * T + t) * K + k]!;
  // q[t·K + k]: best score of track k from frame t to the end; ptr[(T−1−t)·K + k] the choice at begin t
  // (−1 = skip one frame, m ≥ 0 = an interval to frame t + 1 + m).
  // float32 like upstream (torch), so near-ties resolve the same way.
  const q = new Float32Array(T * K);
  const ptr = new Int32Array(Math.max(0, T - 1) * K);
  for (let k = 0; k < K; k++) {
    const d = diag(T - 1, k);
    q[(T - 1) * K + k] = d > 0 ? d : 0;
  }
  const best = new Float32Array(K);
  const sel = new Int32Array(K);
  for (let i = 1; i < T; i++) {
    const j = T - i - 1;
    // Skip: q[j + 1] (+ the no-event score, 0). Ties keep the first candidate, as torch.max does.
    for (let k = 0; k < K; k++) {
      best[k] = q[(j + 1) * K + k]!;
      sel[k] = -1;
    }
    for (let e = j + 1; e < T; e++) {
      const qo = e * K;
      const so = (e * T + j) * K;
      const m = e - j - 1;
      for (let k = 0; k < K; k++) {
        const v = Math.fround(q[qo + k]! + S[so + k]!);
        if (v > best[k]!) {
          best[k] = v;
          sel[k] = m;
        }
      }
    }
    const po = (i - 1) * K;
    for (let k = 0; k < K; k++) {
      ptr[po + k] = sel[k]!;
      const d = diag(j, k);
      q[j * K + k] = best[k]! + (d > 0 ? d : 0);
    }
  }

  for (let k = 0; k < K; k++) {
    const out = result[k]!;
    let j = forcedStartPos?.[k] ?? 0;
    while (j < T - 1) {
      const s = ptr[(T - j - 2) * K + k]!;
      if (diag(j, k) > 0) out.push([j, j]);
      if (s < 0) j += 1;
      else {
        const e = s + j + 1;
        out.push([j, e]);
        j = e;
      }
    }
    if (diag(T - 1, k) > 0) out.push([T - 1, T - 1]);
  }
  return result;
}
