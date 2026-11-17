/**
 * Falling-notes video export: renderFrame → canvas.captureStream + piano audio
 * (MediaStreamAudioDestinationNode) → MediaRecorder WebM. Runs in real time.
 */
import type { Score } from '../../../core/score';
import { scoreDuration } from '../../../core/score';
import { DEFAULT_HAND_COLORS, renderFrame, type HandColors, type Theme } from '../../../core/render';
import type { LabelStyle } from '../../../core/keyboard';
import type { OutputConverter, ProgressFn } from '../../types';
import { loadPiano } from '../../../ui/audio';

export interface VideoExportOptions {
  resolution: 720 | 1080;
  fps: 30 | 60;
  theme: Theme;
  labels: boolean;
  labelStyle: LabelStyle;
  handColors: HandColors;
  /** Seconds of the score to export; defaults to the whole piece plus a 1 s tail. */
  start?: number;
  end?: number;
  /** Include piano audio (default true). */
  audio?: boolean;
}

export const DEFAULT_VIDEO_OPTIONS: VideoExportOptions = {
  resolution: 720,
  fps: 30,
  theme: 'dark',
  labels: false,
  labelStyle: 'letters',
  handColors: DEFAULT_HAND_COLORS,
};

export function pickMimeType(): string {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return (
    candidates.find((c) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) ??
    'video/webm'
  );
}

export async function exportVideo(
  score: Score,
  options: Partial<VideoExportOptions>,
  onProgress: ProgressFn = () => {},
  signal?: AbortSignal,
): Promise<Blob> {
  const o = { ...DEFAULT_VIDEO_OPTIONS, ...options };
  const height = o.resolution;
  const width = Math.round((height * 16) / 9);
  const start = o.start ?? 0;
  const end = o.end ?? scoreDuration(score) + 1;
  const length = Math.max(0.5, end - start);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const render = (t: number) =>
    renderFrame(ctx, score, t, {
      width,
      height,
      theme: o.theme,
      labels: o.labels,
      labelStyle: o.labelStyle,
      handColors: o.handColors,
    });
  render(start);

  const stream = canvas.captureStream(o.fps);
  const piano = await loadPiano();
  const tone = piano.tone;
  await tone.start();
  const raw = tone.getContext().rawContext as AudioContext;
  let dest: MediaStreamAudioDestinationNode | null = null;
  const wasMuted = tone.getDestination().mute;
  if (o.audio !== false) {
    dest = raw.createMediaStreamDestination();
    tone.connect(piano.output, dest);
    for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
    tone.getDestination().mute = true; // don't play through the speakers while exporting
  }

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: height >= 1080 ? 8_000_000 : 4_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (recorder.onstop = () => r()));

  // Schedule audio on the AudioContext timeline, then record in lockstep with it.
  const lead = 0.15;
  const t0 = piano.now() + lead;
  if (dest) {
    for (const n of score.notes) {
      if (n.start + n.duration <= start || n.start >= end) continue;
      const s = Math.max(n.start, start);
      piano.play(n.pitch, Math.min(n.start + n.duration, end) - s, n.velocity, t0 + (s - start));
    }
  }

  await new Promise<void>((resolve, reject) => {
    let started = false;
    let raf = 0;
    const tick = () => {
      if (signal?.aborted) {
        cancelAnimationFrame(raf);
        if (recorder.state !== 'inactive') recorder.stop();
        reject(new DOMException('Export cancelled', 'AbortError'));
        return;
      }
      const elapsed = raw.currentTime - t0;
      if (!started && elapsed >= 0) {
        recorder.start(1000);
        started = true;
      }
      const t = start + Math.max(0, Math.min(elapsed, length));
      render(t);
      onProgress(Math.max(0, Math.min(1, elapsed / length)));
      if (elapsed >= length) {
        recorder.stop();
        resolve();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }).finally(() => {
    piano.releaseAll();
    tone.getDestination().mute = wasMuted;
    if (dest) tone.disconnect(piano.output, dest);
  });

  await stopped;
  for (const t of stream.getTracks()) t.stop();
  onProgress(1);
  return new Blob(chunks, { type: mimeType.split(';')[0] });
}

export const videoOutput: OutputConverter<Partial<VideoExportOptions>> = {
  id: 'video',
  label: 'Falling-notes video (WebM)',
  kind: 'file',
  export: (score, opts) => exportVideo(score, opts),
};
