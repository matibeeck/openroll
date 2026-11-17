import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Score } from '../core/score';
import { scoreDuration } from '../core/score';
import { frameGeometry, renderFrame, type RenderOptions } from '../core/render';
import { PracticeTracker, type PracticeStats } from '../core/practice';
import { Transport } from '../core/transport';
import type { LabelStyle } from '../core/keyboard';
import { loadPiano, type Piano } from './audio';
import { connectComputerKeyboard, connectMidi, type MidiStatus, type NoteHandlers } from './input';
import { useI18n } from '../i18n';

type Hands = 'both' | 'L' | 'R';

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Mount with `key` per score: the transport is created once per mount. */
export function PracticeView({ score }: { score: Score }) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const duration = useMemo(() => scoreDuration(score) + 0.5, [score]);
  const [transport] = useState(() => new Transport(() => performance.now() / 1000, duration));

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [hands, setHands] = useState<Hands>('both');
  const [waitMode, setWaitMode] = useState(false);
  const [labels, setLabels] = useState<'off' | LabelStyle>('off');
  const [stats, setStats] = useState<PracticeStats>({ hits: 0, misses: 0, wrong: 0, accuracy: 100 });
  const [position, setPosition] = useState(0);
  const [loop, setLoop] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const [midi, setMidi] = useState<MidiStatus>({ kind: 'none' });
  const [pianoState, setPianoState] = useState<'idle' | 'loading' | 'ready' | 'fallback'>('idle');

  const pianoRef = useRef<Piano | null>(null);
  const pressedRef = useRef(new Set<number>());
  const trackerRef = useRef<PracticeTracker>(null as unknown as PracticeTracker);
  const fpsRef = useRef(0);

  // Rebuild the tracker when practice settings change.
  useEffect(() => {
    trackerRef.current = new PracticeTracker(score, { hands, waitMode });
    trackerRef.current.reset(transport.time);
    setStats(trackerRef.current.stats);
  }, [score, hands, waitMode, transport]);

  const ensurePiano = useCallback(async () => {
    if (pianoRef.current) return pianoRef.current;
    setPianoState('loading');
    const p = await loadPiano();
    await p.tone.start();
    pianoRef.current = p;
    setPianoState(p.usingFallback ? 'fallback' : 'ready');
    return p;
  }, []);

  // Note input (MIDI + computer keyboard + on-screen keys).
  const handlers = useMemo<NoteHandlers>(
    () => ({
      onNoteOn(pitch, velocity) {
        pressedRef.current.add(pitch);
        trackerRef.current?.noteOn(pitch, transport.time);
        pianoRef.current?.noteOn(pitch, velocity);
        if (!pianoRef.current) void ensurePiano().then((p) => p.noteOn(pitch, velocity));
      },
      onNoteOff(pitch) {
        pressedRef.current.delete(pitch);
        pianoRef.current?.noteOff(pitch);
      },
    }),
    [transport, ensurePiano],
  );

  useEffect(() => {
    let disposeMidi = () => {};
    let cancelled = false;
    void connectMidi(handlers, (s) => !cancelled && setMidi(s)).then((d) => {
      if (cancelled) d();
      else disposeMidi = d;
    });
    const disposeKeys = connectComputerKeyboard(handlers);
    return () => {
      cancelled = true;
      disposeMidi();
      disposeKeys();
    };
  }, [handlers]);

  const settingsRef = useRef<{ opts: Partial<RenderOptions>; wait: boolean; hands: Hands }>({
    opts: {},
    wait: false,
    hands: 'both',
  });
  useEffect(() => {
    settingsRef.current = {
      opts: { hands, labels: labels !== 'off', labelStyle: labels === 'off' ? 'letters' : labels },
      wait: waitMode,
      hands,
    };
  }, [hands, labels, waitMode]);

  // Render + audio scheduling loop.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    let raf = 0;
    let lastT = transport.time;
    let lastFrame = performance.now();
    let uiTick = 0;
    let size = { w: 0, h: 0 };
    const renderMs = { avg: 0, worst: 0 };
    const draw = (t: number) =>
      renderFrame(ctx, score, t, {
        ...settingsRef.current.opts,
        pressed: pressedRef.current,
        width: size.w,
        height: size.h,
      });
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      // Leave room for the controls below so everything fits on one screen.
      const h = Math.max(200, Math.round(Math.min(window.innerHeight - 320, w * 0.5)));
      if (w === size.w && h === size.h) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      size = { w, h };
      draw(lastT); // resizing clears the canvas; repaint now instead of showing a black frame
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    window.addEventListener('resize', resize);

    const frame = () => {
      const now = performance.now();
      const dt = now - lastFrame;
      lastFrame = now;
      if (dt > 0) fpsRef.current = fpsRef.current ? fpsRef.current * 0.95 + (1000 / dt) * 0.05 : 1000 / dt;
      canvas.dataset.fps = fpsRef.current.toFixed(1);

      const tracker = trackerRef.current;
      let tNow = transport.time;
      if (transport.playing) {
        const hold = tracker.update(tNow);
        if (hold !== null) {
          transport.hold(hold);
          tNow = hold;
        }
      }
      if (tNow < lastT - 0.05) {
        // Seek or loop wrap.
        tracker.reset(tNow);
        pianoRef.current?.releaseAll();
        lastT = tNow;
      }
      const piano = pianoRef.current;
      if (piano && transport.playing && tNow > lastT) {
        const sp = transport.speed;
        for (const n of score.notes) {
          if (n.start > tNow) break;
          if (n.start <= lastT) continue;
          const h = settingsRef.current.hands;
          const practiced = h === 'both' || n.hand === h || n.hand === null;
          if (settingsRef.current.wait && practiced) continue; // the player plays these
          piano.play(n.pitch, n.duration / sp, n.velocity);
        }
      }
      lastT = tNow;
      const r0 = performance.now();
      draw(tNow);
      const rms = performance.now() - r0;
      renderMs.avg = renderMs.avg ? renderMs.avg * 0.95 + rms * 0.05 : rms;
      if (transport.playing) renderMs.worst = Math.max(renderMs.worst, rms);
      canvas.dataset.renderMs = renderMs.avg.toFixed(2);
      canvas.dataset.worstRenderMs = renderMs.worst.toFixed(2);
      if (++uiTick % 6 === 0) {
        setPosition(tNow);
        setStats(tracker.stats);
        if (!transport.playing) setPlaying(false);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [score, transport]);

  // Warm up the piano while the user looks at the notes, so the first Play is instant.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 300));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const id = idle(() => void loadPiano());
    return () => cancel(id);
  }, []);

  // Space bar toggles play/pause (unless a form control has focus).
  const playButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      const el = e.target as HTMLElement | null;
      // Text fields keep their space; on buttons Space would re-click them, so we take it over.
      if (
        el &&
        ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) &&
        (el as HTMLInputElement).type !== 'range' &&
        (el as HTMLInputElement).type !== 'checkbox'
      )
        return;
      e.preventDefault();
      playButtonRef.current?.click();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const togglePlay = async () => {
    if (transport.playing) {
      transport.pause();
      pianoRef.current?.releaseAll();
      setPlaying(false);
    } else {
      await ensurePiano();
      transport.play();
      setPlaying(true);
    }
  };

  const pitchAt = (e: React.PointerEvent<HTMLCanvasElement>): number | null => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const g = frameGeometry({ width: r.width, height: r.height, keyboardRatio: 0.18, low: 21, high: 108 });
    if (y < g.kbTop) return null;
    if (y < g.kbTop + g.blackH) {
      const b = g.layout.keys.find((k) => k.black && x >= k.x && x < k.x + k.width);
      if (b) return b.pitch;
    }
    return g.layout.keys.find((k) => !k.black && x >= k.x && x < k.x + k.width)?.pitch ?? null;
  };
  const clickedRef = useRef<number | null>(null);

  const midiText =
    midi.kind === 'connected'
      ? t('practice.midi.connected', { name: midi.name })
      : midi.kind === 'unsupported'
        ? t('practice.midi.unsupported')
        : t('practice.midi.none');

  return (
    <section className="practice" aria-label="practice">
      <div ref={wrapRef} className="practice-canvas">
        <canvas
          ref={canvasRef}
          data-testid="practice-canvas"
          onPointerDown={(e) => {
            const p = pitchAt(e);
            if (p !== null) {
              clickedRef.current = p;
              handlers.onNoteOn(p, 0.8);
            }
          }}
          onPointerUp={() => {
            if (clickedRef.current !== null) handlers.onNoteOff(clickedRef.current);
            clickedRef.current = null;
          }}
        />
      </div>
      <div className="controls">
        <button
          type="button"
          className="primary"
          ref={playButtonRef}
          onClick={() => void togglePlay()}
          data-testid="play"
          title={t('practice.play.tip')}
        >
          {playing ? t('practice.pause') : t('practice.play')}
        </button>
        <button
          type="button"
          onClick={() => {
            transport.seek(loop.a ?? 0);
            setPosition(transport.time);
          }}
        >
          {t('practice.restart')}
        </button>
        <label className="grow seek">
          <span className="sr">{t('practice.seek')}</span>
          {loop.a !== null && (
            <span
              className="loop-band"
              data-testid="loop-band"
              title={t('practice.loop.band')}
              style={{
                left: `${(loop.a / duration) * 100}%`,
                width: `${(((loop.b ?? duration) - loop.a) / duration) * 100}%`,
              }}
            />
          )}
          <input
            type="range"
            min={0}
            max={duration}
            step={0.01}
            value={position}
            onChange={(e) => {
              transport.seek(Number(e.target.value));
              setPosition(transport.time);
            }}
            aria-label={t('practice.seek')}
          />
        </label>
        <span className="time" data-testid="time">
          {fmt(position)} / {fmt(duration)}
        </span>
      </div>
      <div className="controls">
        <label>
          {t('practice.speed')} {Math.round(speed * 100)}%
          <input
            type="range"
            min={0.25}
            max={1.5}
            step={0.05}
            value={speed}
            onChange={(e) => {
              const s = Number(e.target.value);
              transport.setSpeed(s);
              setSpeed(s);
            }}
            aria-label={t('practice.speed')}
          />
        </label>
        <span className="repeat" role="group" aria-label={t('practice.loop.group')}>
          <button
            type="button"
            title={t('practice.loop.tip')}
            data-testid="loop-start"
            onClick={() => {
              const a = transport.time;
              const b = loop.b !== null && loop.b > a ? loop.b : null;
              transport.setLoop(a, b);
              setLoop({ a, b });
            }}
          >
            {t('practice.loopA')}
            {loop.a !== null ? ` ${fmt(loop.a)}` : ''}
          </button>
          <button
            type="button"
            title={t('practice.loop.tip')}
            data-testid="loop-end"
            onClick={() => {
              const b = transport.time;
              const a = loop.a ?? 0;
              if (b > a) {
                transport.setLoop(a, b);
                setLoop({ a, b });
                transport.seek(a);
                setPosition(a);
              }
            }}
          >
            {t('practice.loopB')}
            {loop.b !== null ? ` ${fmt(loop.b)}` : ''}
          </button>
          {loop.a !== null && (
            <button
              type="button"
              className="icon"
              aria-label={t('practice.loopClear')}
              title={t('practice.loopClear')}
              onClick={() => {
                transport.setLoop(null, null);
                setLoop({ a: null, b: null });
              }}
            >
              ×
            </button>
          )}
        </span>
        <label>
          {t('practice.hands')}{' '}
          <select value={hands} onChange={(e) => setHands(e.target.value as Hands)}>
            <option value="both">{t('practice.hands.both')}</option>
            <option value="L">{t('practice.hands.L')}</option>
            <option value="R">{t('practice.hands.R')}</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={waitMode} onChange={(e) => setWaitMode(e.target.checked)} />{' '}
          {t('practice.waitMode')}
        </label>
        <label>
          {t('practice.labels')}{' '}
          <select value={labels} onChange={(e) => setLabels(e.target.value as 'off' | LabelStyle)}>
            <option value="off">{t('practice.labels.off')}</option>
            <option value="letters">{t('practice.labels.letters')}</option>
            <option value="solfege">{t('practice.labels.solfege')}</option>
          </select>
        </label>
      </div>
      <p className="stats" data-testid="stats">
        {stats.hits + stats.wrong > 0 || waitMode
          ? t('practice.score', stats as unknown as Record<string, number>)
          : t('practice.score.idle')}
      </p>
      <p className={`notice ${midi.kind}`} data-testid="midi-status">
        {midiText}
      </p>
      {pianoState === 'loading' && <p className="notice">{t('practice.loading')}</p>}
      {pianoState === 'fallback' && <p className="notice">{t('practice.audio.fallback')}</p>}
    </section>
  );
}
