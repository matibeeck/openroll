/** Segment geometry of Transkun's 16 s / 8 s loop. Pure and dependency-free (the main bundle uses it for progress). */
import { TK_HOP, TK_SAMPLE_RATE, TK_SEGMENT_HOP_SECONDS, TK_SEGMENT_SECONDS } from './constants';

export interface SegmentPlan {
  /** Zeros added before (and after) the audio, in samples. */
  padSamples: number;
  segmentSamples: number;
  stepSamples: number;
  /** First segment's forced start frame (the frame where the audio begins). */
  startFrame: number;
  /** Frame index treated as the segment end for `hasOffset`. */
  lastFrameIdx: number;
  /** Segment start offsets in the padded signal (samples), only those that contain audio. */
  starts: number[];
}

/** Segment geometry for `samples` samples of 44,100 Hz audio (upstream `transcribe`). */
export function planSegments(samples: number): SegmentPlan {
  const padTime = TK_SEGMENT_SECONDS - TK_SEGMENT_HOP_SECONDS;
  const padSamples = Math.ceil(padTime * TK_SAMPLE_RATE);
  const total = samples + 2 * padSamples;
  const stepSamples = Math.ceil((TK_SEGMENT_HOP_SECONDS * TK_SAMPLE_RATE) / TK_HOP) * TK_HOP;
  const segmentSamples = Math.ceil(TK_SEGMENT_SECONDS * TK_SAMPLE_RATE);
  const starts: number[] = [];
  for (let i = 0; i < total; i += stepSamples) if (i < padSamples + samples) starts.push(i);
  return {
    padSamples,
    segmentSamples,
    stepSamples,
    startFrame: Math.floor((padTime * TK_SAMPLE_RATE) / TK_HOP),
    lastFrameIdx: Math.round(segmentSamples / TK_HOP),
    starts,
  };
}

