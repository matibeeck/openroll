/**
 * Falling-notes video (Synthesia-style, or our own M3 export) → Score.
 * Main thread: seek the video and read back pixels (canvas). Worker: calibration + key tracking.
 */
import type { Score } from '../../../core/score';
import type { InputConverter, ProgressFn } from '../../types';
import { needsCalibrationDialog, notesToScore, type Calibration, type DetectOptions, type ManualCalibration, type RgbaFrame } from './detect';
import type { FallingNotesRequest, FallingNotesResponse } from './protocol';
import { FallingNotesError, VideoFrameSource } from './video-frames';

export { FallingNotesError, type FallingNotesErrorCode } from './video-frames';
export {
  CONFIDENCE_OK,
  STANDARD_LOWEST,
  highestKey,
  needsCalibrationDialog,
  type Calibration,
  type CalibrationIssue,
  type CalibrationQuality,
  type KeyCount,
  type ManualCalibration,
} from './detect';

/**
 * Asks the user to check the keyboard position. Receives the idle (median) frame at analysis
 * scale and the automatic result (null when no keyboard was found). Resolve with the adjusted
 * values; reject with an AbortError to cancel the conversion.
 */
export type CalibratePrompt = (frame: ImageData, auto: Calibration | null) => Promise<ManualCalibration>;

export interface FallingNotesOptions {
  /**
   * Manual calibration UI. Called by the converter itself when no keyboard was found or the
   * automatic calibration's confidence is below CONFIDENCE_OK (cropped or 61-key keyboards whose
   * octave is ambiguous, cut-off keys, poor fits), or always with `alwaysCalibrate`.
   */
  calibrate?: CalibratePrompt;
  alwaysCalibrate?: boolean;
  /** Skip the dialog with known values (e.g. from a previous run). */
  manual?: ManualCalibration;
  /** Sampling rate in frames per second (default 30). */
  fps?: number;
  detect?: Partial<DetectOptions>;
}

const CALIBRATION_FRAMES = 9;
const CAL_END = 0.08;
const FRAMES_END = 0.98;

function abortError(): DOMException {
  return new DOMException('Conversion cancelled', 'AbortError');
}

/** Promise-based request/response over the worker; one request in flight at a time. */
class WorkerClient {
  private readonly worker: Worker;
  private pending: { resolve: (m: FallingNotesResponse) => void; reject: (e: unknown) => void } | null = null;

  constructor(signal: AbortSignal) {
    this.worker = new Worker(new URL('../../../workers/falling-notes.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FallingNotesResponse>) => {
      const p = this.pending;
      this.pending = null;
      if (!p) return;
      if (ev.data.type === 'error') p.reject(new Error(`Video analysis failed: ${ev.data.message}`));
      else p.resolve(ev.data);
    };
    this.worker.onerror = (ev) => {
      const p = this.pending;
      this.pending = null;
      p?.reject(new Error(`Video analysis worker crashed: ${ev.message || 'unknown error'}`));
    };
    signal.addEventListener('abort', () => {
      this.pending?.reject(abortError());
      this.pending = null;
      this.close();
    });
  }

  request(msg: FallingNotesRequest, transfer: Transferable[] = []): Promise<FallingNotesResponse> {
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.worker.postMessage(msg, transfer);
    });
  }

  close(): void {
    this.worker.terminate();
  }
}

function titleFromFileName(name: string): string {
  return name.replace(/\.[^./\\]+$/, '').trim() || 'Falling-notes video';
}

/**
 * The converter's calibration decision: explicit `manual` values win; otherwise the dialog is
 * opened (by the converter itself) when needsCalibrationDialog says so. Returns the manual
 * calibration to use, or undefined to keep the automatic one. `idle` builds the dialog's frame.
 */
export async function confirmCalibration(
  auto: Calibration | null,
  idle: () => ImageData,
  opts: Pick<FallingNotesOptions, 'calibrate' | 'alwaysCalibrate' | 'manual'>,
): Promise<ManualCalibration | undefined> {
  if (opts.manual) return opts.manual;
  if (opts.calibrate && needsCalibrationDialog(auto, opts.alwaysCalibrate)) return opts.calibrate(idle(), auto);
  return undefined;
}

function toImageData(f: RgbaFrame): ImageData {
  return new ImageData(new Uint8ClampedArray(f.data), f.width, f.height);
}

export async function transcribeFallingNotesVideo(
  file: File,
  opts: FallingNotesOptions,
  onProgress: ProgressFn,
  signal: AbortSignal,
): Promise<Score> {
  if (signal.aborted) throw abortError();
  const fps = opts.fps ?? 30;
  onProgress(0, 'opening');
  const src = await VideoFrameSource.open(file, signal);
  const worker = new WorkerClient(signal);
  try {
    // 1. Idle keyboard + calibration.
    const frames: RgbaFrame[] = [];
    for (let i = 0; i < CALIBRATION_FRAMES; i++) {
      frames.push(await src.frameAt(((i + 0.5) / CALIBRATION_FRAMES) * src.duration, signal));
      onProgress((CAL_END * (i + 1)) / (CALIBRATION_FRAMES + 1), 'calibrating');
    }
    const cal = await worker.request(
      { type: 'calibrate', frames },
      frames.map((f) => f.data.buffer),
    );
    if (cal.type !== 'calibrated') throw new Error('unexpected worker reply');

    const manual = await confirmCalibration(cal.auto, () => toImageData(cal.idle), opts);
    if (signal.aborted) throw abortError();
    if (!manual && !cal.auto) {
      throw new FallingNotesError(
        'no-keyboard',
        `No piano keyboard was found in “${file.name}”. Use a falling-notes video that shows the whole keyboard, ` +
          `or set its position by hand.`,
      );
    }
    const started = await worker.request({ type: 'start', manual, detect: opts.detect });
    if (started.type !== 'started') throw new Error('unexpected worker reply');
    const { top, bottom } = started.calibration;
    const y0 = Math.max(0, Math.floor(top));
    const y1 = Math.min(src.height, Math.ceil(bottom));
    onProgress(CAL_END, 'reading frames');

    // 2. Step through the video.
    const n = Math.max(1, Math.floor(src.duration * fps));
    for (let k = 0; k <= n; k++) {
      if (signal.aborted) throw abortError();
      const t = Math.min(src.duration, k / fps);
      const strip = await src.stripAt(t, y0, y1, signal);
      await worker.request({ type: 'frame', t, strip, yOffset: y0 }, [strip.data.buffer]);
      onProgress(CAL_END + (FRAMES_END - CAL_END) * (k / n), 'reading frames');
    }
    const done = await worker.request({ type: 'finish' });
    if (done.type !== 'notes') throw new Error('unexpected worker reply');
    const score = notesToScore(done.notes, { title: titleFromFileName(file.name) });
    onProgress(1);
    return score;
  } finally {
    worker.close();
    src.close();
  }
}

export const fallingNotesVideoInput: InputConverter<FallingNotesOptions> = {
  id: 'falling-notes-video',
  label: 'Falling-notes video',
  accepts: {
    extensions: ['.mp4', '.webm', '.mov', '.m4v'],
    mimeTypes: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v'],
  },
  convert: (file: File, opts: FallingNotesOptions, onProgress: ProgressFn, signal: AbortSignal) =>
    transcribeFallingNotesVideo(file, opts ?? {}, onProgress, signal),
};
