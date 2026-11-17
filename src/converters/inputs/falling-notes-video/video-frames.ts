/**
 * Browser-only frame sampling: a <video> element is stepped by seeking (deterministic, works in
 * background tabs, independent of playback speed) and drawn into a canvas at analysis scale.
 */
import type { RgbaFrame } from './detect';

export type FallingNotesErrorCode = 'video-unsupported' | 'no-keyboard';

/** Errors with a stable `code` (i18n key `error.<code>`) and a user-facing English message. */
export class FallingNotesError extends Error {
  constructor(
    readonly code: FallingNotesErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FallingNotesError';
  }
}

/** Frames are analysed at most this wide (1080p/4K are scaled down; keys stay > 20 px wide). */
export const MAX_ANALYSIS_WIDTH = 1280;

function abortError(): DOMException {
  return new DOMException('Conversion cancelled', 'AbortError');
}

function once(target: EventTarget, events: string[], signal: AbortSignal, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      for (const e of events) target.removeEventListener(e, on);
      signal.removeEventListener('abort', onAbort);
    };
    const on = (ev: Event) => {
      cleanup();
      resolve(ev.type);
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve('timeout');
    }, timeoutMs);
    for (const e of events) target.addEventListener(e, on, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class VideoFrameSource {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  private readonly ctx: CanvasRenderingContext2D;

  private constructor(
    private readonly video: HTMLVideoElement,
    private readonly url: string,
    readonly duration: number,
  ) {
    this.scale = Math.min(1, MAX_ANALYSIS_WIDTH / video.videoWidth);
    this.width = Math.max(1, Math.round(video.videoWidth * this.scale));
    this.height = Math.max(1, Math.round(video.videoHeight * this.scale));
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
    if (!ctx) throw new FallingNotesError('video-unsupported', 'This browser cannot read video frames (no 2D canvas).');
    this.ctx = ctx;
  }

  static async open(file: Blob & { name?: string }, signal: AbortSignal): Promise<VideoFrameSource> {
    const name = file.name ? `“${file.name}”` : 'this video';
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const url = URL.createObjectURL(file);
    video.src = url;
    const unsupported = () =>
      new FallingNotesError(
        'video-unsupported',
        `Your browser couldn't play ${name}. Its format or codec may not be supported here; ` +
          `try an MP4 (H.264) or WebM file, or Chrome or Firefox.`,
      );
    try {
      const ev = await once(video, ['loadedmetadata', 'error'], signal, 20_000);
      if (ev !== 'loadedmetadata' || !video.videoWidth) throw unsupported();
      let duration = video.duration;
      if (!Number.isFinite(duration)) {
        // MediaRecorder WebM has no duration header: seeking far forces the browser to compute it.
        video.currentTime = 1e7;
        await once(video, ['durationchange', 'seeked'], signal, 10_000);
        duration = video.duration;
        if (!Number.isFinite(duration) && video.seekable.length) duration = video.seekable.end(video.seekable.length - 1);
      }
      if (!Number.isFinite(duration) || duration <= 0) throw unsupported();
      return new VideoFrameSource(video, url, duration);
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
  }

  private async seek(t: number, signal: AbortSignal): Promise<void> {
    const target = Math.min(Math.max(0, t), this.duration);
    if (Math.abs(this.video.currentTime - target) < 1e-4 && this.video.readyState >= 2) return;
    this.video.currentTime = target;
    await once(this.video, ['seeked'], signal, 5_000);
  }

  /** Whole frame at analysis scale. */
  async frameAt(t: number, signal: AbortSignal): Promise<RgbaFrame> {
    await this.seek(t, signal);
    this.ctx.drawImage(this.video, 0, 0, this.width, this.height);
    const img = this.ctx.getImageData(0, 0, this.width, this.height);
    return { width: img.width, height: img.height, data: img.data };
  }

  /** Rows [y0, y1) of the analysis-scale frame (only the keyboard strip is read back). */
  async stripAt(t: number, y0: number, y1: number, signal: AbortSignal): Promise<RgbaFrame> {
    await this.seek(t, signal);
    const h = Math.max(1, y1 - y0);
    const s = this.scale;
    this.ctx.drawImage(this.video, 0, y0 / s, this.video.videoWidth, h / s, 0, 0, this.width, h);
    const img = this.ctx.getImageData(0, 0, this.width, h);
    return { width: img.width, height: img.height, data: img.data };
  }

  close(): void {
    this.video.removeAttribute('src');
    this.video.load();
    URL.revokeObjectURL(this.url);
  }
}
