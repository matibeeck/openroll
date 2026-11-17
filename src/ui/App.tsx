import { lazy, Suspense, useRef, useState } from 'react';
import type { Score } from '../core/score';
import { scoreDuration } from '../core/score';
import { converterIdFor, detectKind } from '../converters/detect';
import { findInputConverter } from '../converters/registry';
import { I18nProvider, useI18n, type Lang } from '../i18n';
import { PracticeView } from './PracticeView';

// Sheet music pulls in Verovio (LGPL, WASM): keep it in a separately loaded chunk.
const SheetView = lazy(() => import('./SheetView'));
const DownloadView = lazy(() => import('./DownloadView'));

type Tab = 'practice' | 'sheet' | 'video' | 'download';
type State =
  | { kind: 'home'; error?: string }
  | { kind: 'ask-video'; file: File }
  | { kind: 'converting'; file: File; progress: number; label?: string }
  | { kind: 'result'; score: Score; name: string; id: number };

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

  const convert = async (file: File, videoMode?: 'falling-notes' | 'performance') => {
    const kind = detectKind(file.name, file.type);
    if (kind === 'unknown') return setState({ kind: 'home', error: t('home.unknown', { name: file.name }) });
    if (kind === 'video' && !videoMode) return setState({ kind: 'ask-video', file });
    const id = converterIdFor(kind, videoMode);
    const conv = id ? findInputConverter(id) : undefined;
    if (!conv) return setState({ kind: 'home', error: t('home.unknown', { name: file.name }) });
    const ac = new AbortController();
    abortRef.current = ac;
    setState({ kind: 'converting', file, progress: 0 });
    try {
      const score = await conv.convert(
        file,
        {},
        (progress, label) => setState({ kind: 'converting', file, progress, label }),
        ac.signal,
      );
      setTab('practice');
      setState({ kind: 'result', score, name: file.name, id: ++idRef.current });
    } catch (e) {
      if ((e as Error).name === 'AbortError') setState({ kind: 'home' });
      else setState({ kind: 'home', error: t('home.error', { name: file.name, msg: (e as Error).message }) });
    } finally {
      abortRef.current = null;
    }
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

      {state.kind === 'converting' && (
        <main className="dropzone">
          <h2>{t('home.converting', { name: state.file.name })}</h2>
          <progress max={1} value={state.progress} data-testid="convert-progress" />
          <p>
            {Math.round(state.progress * 100)}% {state.label ?? ''}
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
            <button type="button" onClick={() => setState({ kind: 'home' })}>
              {t('home.back')}
            </button>
          </div>
          <nav className="tabs" role="tablist">
            {(['practice', 'sheet', 'download'] as Tab[]).map((k) => (
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
            {tab === 'sheet' && <SheetView key={state.id} score={state.score} />}
            {tab === 'download' && <DownloadView key={state.id} score={state.score} />}
          </Suspense>
        </main>
      )}

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
