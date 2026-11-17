import { useEffect, useRef, useState } from 'react';
import type { Score } from '../core/score';
import { DEFAULT_HAND_COLORS, renderFrame } from '../core/render';
import { scoreDuration } from '../core/score';
import { DEFAULT_VIDEO_OPTIONS, exportVideo, type VideoExportOptions } from '../converters/outputs/video';
import { useI18n } from '../i18n';
import { safeFileName } from './download';

export function VideoView({ score }: { score: Score }) {
  const { t } = useI18n();
  const [opts, setOpts] = useState<VideoExportOptions>(DEFAULT_VIDEO_OPTIONS);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ url: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Live preview of one frame with the chosen options (a moment where notes are falling).
  const previewRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = previewRef.current;
    const ctx = c?.getContext('2d', { alpha: false });
    if (!c || !ctx) return;
    const t = (score.notes[0]?.start ?? 0) + 0.8;
    renderFrame(ctx, score, t, {
      width: c.width,
      height: c.height,
      theme: opts.theme,
      labels: opts.labels,
      labelStyle: opts.labelStyle,
      handColors: opts.handColors,
    });
  }, [score, opts]);
  const total = scoreDuration(score) + 1;
  const estimate =
    total < 60 ? `${Math.ceil(total)} s` : `${Math.floor(total / 60)} min ${Math.round(total % 60)} s`;
  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result]);

  const set = <K extends keyof VideoExportOptions>(k: K, v: VideoExportOptions[K]) =>
    setOpts({ ...opts, [k]: v });
  const supported = typeof MediaRecorder !== 'undefined';

  const run = async () => {
    setError(null);
    setResult(null);
    setProgress(0);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      // Test hook: ?clip=N exports only the first N seconds.
      const clip = Number(new URLSearchParams(location.search).get('clip')) || undefined;
      const blob = await exportVideo(score, { ...opts, end: clip }, (f) => setProgress(f), ac.signal);
      setResult({ url: URL.createObjectURL(blob), size: blob.size });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        const code = (e as { code?: string }).code;
        setError(code === 'audio-suspended' ? t('error.audio-suspended') : (e as Error).message);
      }
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  if (!supported) return <p className="notice error">{t('video.unsupported')}</p>;
  const busy = progress !== null;
  return (
    <section className="video-view">
      <div className="controls">
        <label>
          {t('video.resolution')}{' '}
          <select
            value={opts.resolution}
            disabled={busy}
            onChange={(e) => set('resolution', Number(e.target.value) as 720 | 1080)}
          >
            <option value={720}>720p</option>
            <option value={1080}>1080p</option>
          </select>
        </label>
        <label>
          {t('video.fps')}{' '}
          <select
            value={opts.fps}
            disabled={busy}
            onChange={(e) => set('fps', Number(e.target.value) as 30 | 60)}
          >
            <option value={30}>30</option>
            <option value={60}>60</option>
          </select>
        </label>
        <label>
          {t('video.theme')}{' '}
          <select
            value={opts.theme}
            disabled={busy}
            onChange={(e) => set('theme', e.target.value as 'dark' | 'light')}
          >
            <option value="dark">{t('video.theme.dark')}</option>
            <option value="light">{t('video.theme.light')}</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={opts.labels}
            disabled={busy}
            onChange={(e) => set('labels', e.target.checked)}
          />{' '}
          {t('video.labels')}
        </label>
        <label>
          {t('video.colorR')}{' '}
          <input
            type="color"
            value={opts.handColors.R}
            disabled={busy}
            onChange={(e) => set('handColors', { ...opts.handColors, R: e.target.value })}
          />
        </label>
        <label>
          {t('video.colorL')}{' '}
          <input
            type="color"
            value={opts.handColors.L ?? DEFAULT_HAND_COLORS.L}
            disabled={busy}
            onChange={(e) => set('handColors', { ...opts.handColors, L: e.target.value })}
          />
        </label>
      </div>
      <p className="notice">{t('video.preview')}</p>
      <canvas
        ref={previewRef}
        width={640}
        height={360}
        className="video-preview-canvas"
        data-testid="video-live-preview"
      />
      <p className="notice">{t('video.estimate', { time: estimate })}</p>
      <div className="controls">
        {!busy ? (
          <button type="button" className="primary" onClick={() => void run()} data-testid="export-video">
            {t('video.export')}
          </button>
        ) : (
          <>
            <progress max={1} value={progress} />
            <span>{t('video.exporting', { pct: Math.round(progress * 100) })}</span>
            <button type="button" onClick={() => abortRef.current?.abort()}>
              {t('video.cancel')}
            </button>
          </>
        )}
      </div>
      {error && <p className="notice error">{t('video.error', { msg: error })}</p>}
      {result && (
        <div className="video-result">
          <p>{t('video.done', { size: (result.size / 1e6).toFixed(1) })}</p>
          <video src={result.url} controls data-testid="video-preview" />
          <a
            className="button"
            href={result.url}
            download={`${safeFileName(score.title)}.webm`}
            data-testid="download-video"
          >
            {t('video.download')}
          </a>
        </div>
      )}
    </section>
  );
}
