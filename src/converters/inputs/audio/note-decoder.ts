/**
 * Frame/onset activations → note events. A port of `outputToNotesPoly` from
 * @spotify/basic-pitch 1.0.1 (src/toMidi.ts, Copyright 2022 Spotify AB, Apache-2.0) that returns
 * the same events, only faster.
 *
 * Why: in the original, the "melodia trick" (notes from leftover frame energy) rescans the whole
 * frames × 88 matrix twice for every note it adds, which is quadratic in the recording length
 * (60 s ≈ 0.6 s, 5 min ≈ tens of seconds). Here every candidate cell above the threshold is
 * sorted once in the order the original would pick them (value desc, then first row, then last
 * column — its argMax/reduce tie rules) and taken lazily: cells only ever drop to 0, so a cell
 * whose value is unchanged is the current global maximum. Same arithmetic, same order of
 * operations everywhere else, so the output is identical (checked against the original in
 * tests/roundtrip/audio.test.ts).
 *
 * Differences from the original API: never mutates its inputs; no maxFreq/minFreq (unused here).
 *
 * One optional fix (`plateauPeaks`, used by the app): the original only accepts strict local
 * maxima as onset peaks, but its inferred onsets rescale the largest frame rise in the file to
 * exactly the largest onset value. When both fall on adjacent frames of the same note (typical
 * for the loudest, cleanest attack) the peak is a flat top of two equal values and that note is
 * silently lost — only the melodia step could bring it back. With `plateauPeaks` the first frame
 * of a flat top counts as the peak.
 */

export interface NoteEventFrames {
  startFrame: number;
  durationFrames: number;
  pitchMidi: number;
  amplitude: number;
}

const MIDI_OFFSET = 21;
const MAX_FREQ_IDX = 87;

function globalMax(rows: number[][]): number {
  let m = 0;
  for (const row of rows) for (let j = 0; j < row.length; j++) if (row[j]! > m) m = row[j]!;
  return m;
}

/** Onsets inferred from frame-activation rises (max of the given onsets and the scaled rises). */
function inferredOnsets(onsets: number[][], frames: number[][], nDiff = 2): number[][] {
  const nRows = frames.length;
  const nCols = frames[0]!.length;
  // frameDiff[r][c] = max(0, min over n=1..nDiff of frames[r][c] − frames[r−n][c]); rows < nDiff = 0.
  const diff: number[][] = new Array(nRows);
  for (let r = 0; r < nRows; r++) {
    const row = new Array<number>(nCols);
    if (r < nDiff) row.fill(0);
    else {
      const cur = frames[r]!;
      for (let c = 0; c < nCols; c++) {
        let m = Infinity;
        for (let n = 1; n <= nDiff; n++) {
          const prev = r - n >= 0 ? frames[r - n]![c]! : 0;
          m = Math.min(m, cur[c]! - prev);
        }
        row[c] = Math.max(m, 0);
      }
    }
    diff[r] = row;
  }
  const onsetMax = globalMax(onsets);
  const diffMax = globalMax(diff);
  const out: number[][] = new Array(nRows);
  for (let r = 0; r < nRows; r++) {
    const o = onsets[r]!;
    const d = diff[r]!;
    const row = new Array<number>(nCols);
    for (let c = 0; c < nCols; c++) row[c] = Math.max(o[c]!, (onsetMax * d[c]!) / diffMax);
    out[r] = row;
  }
  return out;
}

/** Same semantics and defaults as basic-pitch's outputToNotesPoly (inferOnsets on, no freq limits). */
export function outputToNotesPolyFast(
  frames: number[][],
  onsets: number[][],
  onsetThresh = 0.5,
  frameThresh = 0.3,
  minNoteLen = 5,
  inferOnsets = true,
  melodiaTrick = true,
  energyTolerance = 11,
  plateauPeaks = false,
): NoteEventFrames[] {
  const nFrames = frames.length;
  if (nFrames === 0) return [];
  const nCols = frames[0]!.length;
  const onsetsUsed = inferOnsets ? inferredOnsets(onsets, frames) : onsets;

  // Onset peaks (strict local maxima along time, order 1) above the threshold, collected in the
  // original's order (row-major), then processed in reverse.
  const starts: number[] = [];
  const freqs: number[] = [];
  for (let r = 0; r < nFrames; r++) {
    const row = onsetsUsed[r]!;
    for (let c = 0; c < nCols; c++) {
      const v = row[c]!;
      const next = r === nFrames - 1 ? -Infinity : onsetsUsed[r + 1]![c]!;
      const isPeak = (r === 0 || v > onsetsUsed[r - 1]![c]!) && (v > next || (plateauPeaks && v === next));
      if (isPeak && v > onsetThresh) {
        starts.push(r);
        freqs.push(c);
      }
    }
  }

  const remaining = frames.map((f) => f.slice());
  const events: NoteEventFrames[] = [];
  const clearAround = (j: number, freqIdx: number) => {
    const row = remaining[j]!;
    row[freqIdx] = 0;
    if (freqIdx < MAX_FREQ_IDX) row[freqIdx + 1] = 0;
    if (freqIdx > 0) row[freqIdx - 1] = 0;
  };
  const meanAmplitude = (from: number, to: number, freqIdx: number) => {
    let sum = 0;
    for (let j = from; j < to; j++) sum += frames[j]![freqIdx]!;
    return sum / (to - from);
  };

  for (let idx = starts.length - 1; idx >= 0; idx--) {
    const startIdx = starts[idx]!;
    const freqIdx = freqs[idx]!;
    if (startIdx >= nFrames - 1) continue;
    let i = startIdx + 1;
    let k = 0;
    while (i < nFrames - 1 && k < energyTolerance) {
      if (remaining[i]![freqIdx]! < frameThresh) k += 1;
      else k = 0;
      i += 1;
    }
    i -= k;
    if (i - startIdx <= minNoteLen) continue;
    for (let j = startIdx; j < i; ++j) clearAround(j, freqIdx);
    events.push({
      startFrame: startIdx,
      durationFrames: i - startIdx,
      pitchMidi: freqIdx + MIDI_OFFSET,
      amplitude: meanAmplitude(startIdx, i, freqIdx),
    });
  }

  if (!melodiaTrick) return events;

  // Candidates: every cell above the threshold, in the order the original's full rescans would
  // pick them. Its row reduce keeps the first row on ties; within a row its argMax keeps the last
  // column on ties. (One corner case is not replicated: a tie with cell [0][0] while row 0 still
  // holds the maximum. Activations are continuous floats; it has not occurred in any test.)
  const candRow: number[] = [];
  const candCol: number[] = [];
  const candVal: number[] = [];
  for (let r = 0; r < nFrames; r++) {
    const row = remaining[r]!;
    for (let c = 0; c < nCols; c++) {
      if (row[c]! > frameThresh) {
        candRow.push(r);
        candCol.push(c);
        candVal.push(row[c]!);
      }
    }
  }
  const order = Array.from(candVal.keys()).sort(
    (a, b) => candVal[b]! - candVal[a]! || candRow[a]! - candRow[b]! || candCol[b]! - candCol[a]!,
  );

  for (const ci of order) {
    const iMid = candRow[ci]!;
    const freqIdx = candCol[ci]!;
    // Already consumed by an earlier note (cells only ever drop to 0).
    if (remaining[iMid]![freqIdx] !== candVal[ci]) continue;
    remaining[iMid]![freqIdx] = 0;
    let i = iMid + 1;
    let k = 0;
    while (i < nFrames - 1 && k < energyTolerance) {
      if (remaining[i]![freqIdx]! < frameThresh) k += 1;
      else k = 0;
      clearAround(i, freqIdx);
      i += 1;
    }
    const iEnd = i - 1 - k;
    i = iMid - 1;
    k = 0;
    while (i > 0 && k < energyTolerance) {
      if (remaining[i]![freqIdx]! < frameThresh) k += 1;
      else k = 0;
      clearAround(i, freqIdx);
      i -= 1;
    }
    const iStart = i + 1 + k;
    if (iEnd - iStart <= minNoteLen) continue;
    events.push({
      startFrame: iStart,
      durationFrames: iEnd - iStart,
      pitchMidi: freqIdx + MIDI_OFFSET,
      amplitude: meanAmplitude(iStart, iEnd, freqIdx),
    });
  }
  return events;
}
