import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { Score } from '../core/score';
import { scoreDuration } from '../core/score';
import { converterIdFor, detectKind } from '../converters/detect';
import { demoScore } from '../core/demo';
import { DEFAULT_TRANSCRIPTION_MODE, prewarmAudioTranscriber, type TranscriptionMode } from '../converters/inputs/audio';
import { findInputConverter } from '../converters/registry';
import { I18nProvider, useI18n, type Lang } from '../i18n';
import { en, type Messages } from '../i18n/en';
import { useCalibrationPrompt } from './CalibrationDialog';
import { ModeChoice } from './ModeChoice';
import { PracticeView } from './PracticeView';
import { VideoView } from './VideoView';
import { defaultSheetSettings, type SheetSettings } from './sheetSettings';

// Sheet music pulls in Verovio (LGPL, WASM): keep it in a separately loaded chunk.
const SheetView = lazy(() => import('./SheetView'));
const DownloadView = lazy(() => import('./DownloadView'));

type Tab = 'practice' | 'sheet' | 'video' | 'download';
type State =
  | { kind: 'home'; error?: string }
  | { kind: 'ask-video'; file: File }
  | { kind: 'ask-mode'; file: File; videoMode?: 'performance' }
  | { kind: 'converting'; file: File; progress: number; label?: string; startedAt: number }
  | {
      kind: 'result';
      score: Score;
      name: string;
      id: number;
      sheet: SheetSettings;
      file: File;
      videoMode?: 'falling-notes' | 'performance';
    };

function fmtDuration(s: number): string {
  const total = Math.round(s);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

function Shell() {
  const { t, lang, setLang } = useI18n();
  const [state, setState] = useState<State>({ kind: 'home' });
  const [tab, setTab] = useState<Tab>('practice');
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  const { dialog, calibrate } = useCalibrationPrompt();

  const convert = async (
    file: File,
    videoMode?: 'falling-notes' | 'performance',
    recalibrate = false,
    mode?: TranscriptionMode,
  ) => {
    const kind = detectKind(file.name, file.type);
    if (kind === 'unknown') return setState({ kind: 'home', error: t('home.unknown', { name: file.name }) });
    // Start loading the fast note model while the file is decoded (or while the user answers the questions).
    if ((kind === 'audio' || (kind === 'video' && videoMode !== 'falling-notes')) && (mode ?? DEFAULT_TRANSCRIPTION_MODE) === 'fast')
      prewarmAudioTranscriber();
    if (kind === 'video' && !videoMode) return setState({ kind: 'ask-video', file });
    const id = converterIdFor(kind, videoMode);
    // Audio and performance videos: fast (any instrument) or high precision (piano)?
    if ((id === 'audio' || id === 'performance-video') && !mode)
      return setState({ kind: 'ask-mode', file, videoMode: videoMode === 'performance' ? 'performance' : undefined });
    const conv = id ? findInputConverter(id) : undefined;
    if (!conv) return setState({ kind: 'home', error: t('home.unknown', { name: file.name }) });
    const ac = new AbortController();
    abortRef.current = ac;
    const startedAt = performance.now();
    setState({ kind: 'converting', file, progress: 0, startedAt });
    try {
      const opts = id === 'falling-notes-video' ? { calibrate, alwaysCalibrate: recalibrate } : { mode };
      const score = await conv.convert(
        file,
        opts,
        (progress, label) => setState({ kind: 'converting', file, progress, label, startedAt }),
        ac.signal,
      );
      setTab('practice');
      setState({
        kind: 'result',
        score,
        name: file.name,
        id: ++idRef.current,
        sheet: defaultSheetSettings(score),
        file,
        videoMode,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') setState({ kind: 'home' });
      else {
        // Converters attach a stable `code` to user-facing errors; translate it when we know it.
        const code = (e as { code?: string }).code;
        const key = `error.${code}` as keyof Messages;
        const msg = code && key in en ? t(key, { name: file.name }) : (e as Error).message;
        setState({ kind: 'home', error: t('home.error', { name: file.name, msg }) });
      }
    } finally {
      abortRef.current = null;
    }
  };

  // Clock for the remaining-time estimate, ticking only while converting.
  const [now, setNow] = useState(0);
  const converting = state.kind === 'converting';
  useEffect(() => {
    if (!converting) return;
    const id = window.setInterval(() => setNow(performance.now()), 500);
    return () => window.clearInterval(id);
  }, [converting]);

  // Labels may carry values after the stage name: `downloading-model:<done>:<total>`.
  const stageText = (label?: string) => {
    if (!label) return '';
    const [name, done, total] = label.split(':');
    const key = `stage.${name}` as keyof Messages;
    return key in en ? t(key, { done: done ?? '', total: total ?? '' }) : label;
  };
  const eta = (s: { progress: number; startedAt: number }) => {
    const elapsed = (now - s.startedAt) / 1000;
    if (s.progress < 0.05 || elapsed < 1) return t('home.eta.estimating');
    const left = Math.max(0, (elapsed * (1 - s.progress)) / s.progress);
    const time =
      left < 60 ? `${Math.ceil(left)} s` : `${Math.floor(left / 60)} min ${Math.round(left % 60)} s`;
    return t('home.eta', { time });
  };

  const onFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (f) void convert(f);
  };

  return (
    <div className="app">
      <header>
        <button
          type="button"
          className="brand"
          onClick={() => setState({ kind: 'home' })}
          aria-label="OpenRoll"
        >
          <img src="./icon.svg" alt="" width={28} height={28} />
          <h1>OpenRoll</h1>
        </button>
        <span className="tagline">{t('app.tagline')}</span>
        <label className="lang">
          <span className="sr">{t('lang.label')}</span>
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t('lang.label')}>
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </label>
      </header>

      {state.kind === 'home' && (
        <main
          className={`dropzone ${dragging ? 'dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onFiles(e.dataTransfer.files);
          }}
          data-testid="dropzone"
        >
          <h2>{t('home.drop')}</h2>
          <label className="button primary">
            {t('home.pick')}
            <input type="file" data-testid="file-input" onChange={(e) => onFiles(e.target.files)} hidden />
          </label>
          <button
            type="button"
            className="demo"
            data-testid="demo"
            onClick={() => {
              const score = demoScore();
              setTab('practice');
              setState({
                kind: 'result',
                score,
                name: score.title,
                id: ++idRef.current,
                sheet: defaultSheetSettings(score),
                file: new File([], 'demo.mid'),
              });
            }}
          >
            {t('home.demo')}
          </button>
          <p className="formats">{t('home.formats')}</p>
          {state.error && (
            <p className="notice error" role="alert">
              {state.error}
            </p>
          )}
        </main>
      )}

      {state.kind === 'ask-video' && (
        <main className="dropzone">
          <h2>{t('home.videoQuestion')}</h2>
          <div className="controls center">
            <button
              type="button"
              className="primary"
              onClick={() => void convert(state.file, 'falling-notes')}
            >
              {t('home.video.falling')}
            </button>
            <button type="button" className="primary" onClick={() => void convert(state.file, 'performance')}>
              {t('home.video.performance')}
            </button>
          </div>
        </main>
      )}

      {state.kind === 'ask-mode' && (
        <ModeChoice
          onChoose={(mode) => void convert(state.file, state.videoMode, false, mode)}
          onCancel={() => setState({ kind: 'home' })}
        />
      )}

      {state.kind === 'converting' && (
        <main className="dropzone">
          <h2>{t('home.converting', { name: state.file.name })}</h2>
          <progress max={1} value={state.progress} data-testid="convert-progress" />
          <p data-testid="convert-status">
            {Math.round(state.progress * 100)}% · {stageText(state.label)}
          </p>
          <p className="eta" data-testid="convert-eta">
            {eta(state)}
          </p>
          <button type="button" onClick={() => abortRef.current?.abort()}>
            {t('home.cancel')}
          </button>
        </main>
      )}

      {state.kind === 'result' && (
        <main className="result">
          <div className="result-head">
            <h2 data-testid="score-title">{state.score.title || state.name}</h2>
            <span data-testid="score-summary">
              {t('result.summary', {
                notes: state.score.notes.length,
                duration: fmtDuration(scoreDuration(state.score)),
              })}
            </span>
            {state.videoMode === 'falling-notes' && (
              <button type="button" onClick={() => void convert(state.file, 'falling-notes', true)}>
                {t('home.recalibrate')}
              </button>
            )}
            <button type="button" onClick={() => setState({ kind: 'home' })}>
              {t('home.back')}
            </button>
          </div>
          <nav className="tabs" role="tablist">
            {(['practice', 'sheet', 'video', 'download'] as Tab[]).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className={tab === k ? 'active' : ''}
                onClick={() => setTab(k)}
              >
                {t(`tabs.${k}`)}
              </button>
            ))}
          </nav>
          <Suspense fallback={<p>{t('sheet.loading')}</p>}>
            {tab === 'practice' && <PracticeView key={state.id} score={state.score} />}
            {tab === 'sheet' && (
              <SheetView
                key={state.id}
                score={state.score}
                settings={state.sheet}
                onSettings={(sheet) => setState({ ...state, sheet })}
              />
            )}
            {tab === 'video' && <VideoView key={state.id} score={state.score} />}
            {tab === 'download' && <DownloadView key={state.id} score={state.score} settings={state.sheet} />}
          </Suspense>
        </main>
      )}

      {dialog}
      <footer>
        <p>{t('privacy.notice')}</p>
      </footer>
    </div>
  );
}

export function App() {
  return (
    <I18nProvider>
      <Shell />
    </I18nProvider>
  );
}
