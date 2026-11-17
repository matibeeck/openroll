/** Messages between the falling-notes converter (main thread) and src/workers/falling-notes.worker.ts. */
import type { Calibration, DetectedNote, DetectOptions, ManualCalibration, RgbaFrame } from './detect';

export type FallingNotesRequest =
  /** Full frames (analysis scale) spread over the video; their median is the idle keyboard. */
  | { type: 'calibrate'; frames: RgbaFrame[] }
  /** Start tracking with the auto calibration (none given), a full one, or the dialog's values. */
  | { type: 'start'; calibration?: Calibration; manual?: ManualCalibration; detect?: Partial<DetectOptions> }
  /** Keyboard strip: rows [yOffset, yOffset + strip.height) of the analysis-scale frame at time t. */
  | { type: 'frame'; t: number; strip: RgbaFrame; yOffset: number }
  | { type: 'finish' };

export type FallingNotesResponse =
  | { type: 'calibrated'; auto: Calibration | null; idle: RgbaFrame }
  | { type: 'started'; calibration: Calibration }
  | { type: 'ack' }
  | { type: 'notes'; notes: DetectedNote[] }
  | { type: 'error'; message: string };
