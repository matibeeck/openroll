import { useEffect, useMemo, useRef, useState } from 'react';
import { isFreeTiming, quantize, tapTempo } from '../core/quantize';
import type { Score, TimeSignature } from '../core/score';
import { quantizedToMusicXml } from '../converters/outputs/musicxml';
import { renderSheet, type SheetResult } from '../converters/outputs/sheet';
import { useI18n } from '../i18n';

const TIME_SIGNATURES = ['2/4', '3/4', '4/4', '5/4', '3/8', '6/8', '9/8', '12/8'];
const MIN_BPM = 20;
const MAX_BPM = 400;

function parseTimeSig(s: string): TimeSignature {
  const [n, d] = s.split('/').map(Number);
  return { numerator: n || 4, denominator: d || 4 };
}

interface Request {
  xml: string;
  width: number;
  scale: number;
}

interface Result {
  request: Request;
  sheet: SheetResult | null;
  error: string | null;
}

/** Sheet music tab: quantized two-staff score rendered by Verovio in a worker, one page at a time. */
export default function SheetView({ score }: { score: Score }) {
  const { t } = useI18n();
  const free = useMemo(() => isFreeTiming(score), [score]);
  const [bpmText, setBpmText] = useState(() => String(Math.round(score.tempos[0]?.bpm ?? 120)));
  const [timeSig, setTimeSig] = useState(() => `${score.timeSignature.numerator}/${score.timeSignature.denominator}`);
  const [scale, setScale] = useState(40);
  const [page, setPage] = useState(0);
  const [width, setWidth] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const wrapRef = useRef<HTMLElement>(null);
  const taps = useRef<number[]>([]);

  // Page width follows the container; ResizeObserver fires once right after observe().
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth((old) => (Math.abs(old - w) > 8 ? w : old));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bpm = useMemo(() => {
    const v = Number(bpmText);
    return Number.isFinite(v) && v >= MIN_BPM && v <= MAX_BPM ? v : undefined;
  }, [bpmText]);

  const quantized = useMemo(
    () => quantize(score, free ? { bpm, timeSignature: parseTimeSig(timeSig) } : {}),
    [score, free, bpm, timeSig],
  );
  const xml = useMemo(() => quantizedToMusicXml(quantized), [quantized]);
  const request = useMemo<Request | null>(() => (width > 0 ? { xml, width, scale } : null), [xml, width, scale]);

  useEffect(() => {
    if (!request) return;
    const ac = new AbortController();
    renderSheet(request.xml, { width: request.width, scale: request.scale }, ac.signal).then(
      (sheet) => setResult({ request, sheet, error: null }),
      (e: unknown) => {
        if (ac.signal.aborted) return;
        setResult({ request, sheet: null, error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => ac.abort();
  }, [request]);

  const loading = !result || result.request !== request;
  // Keep showing the previous pages while a new rendering is on its way.
  const pages = result?.sheet?.pages ?? [];
  const pageIndex = Math.min(page, Math.max(0, pages.length - 1));
  const svg = pages[pageIndex] ?? '';

  const onTap = () => {
    const now = performance.now();
    taps.current = [...taps.current.filter((x) => now - x < 8000), now];
    const b = tapTempo(taps.current);
    if (b !== null && b >= MIN_BPM && b <= MAX_BPM) setBpmText(String(Math.round(b)));
  };

  return (
    <section ref={wrapRef} className="sheet" aria-label="sheet">
      {free && (
        <>
          <p className="notice">{t('sheet.freeHint')}</p>
          <div className="controls">
            <label>
              {t('sheet.bpm')}{' '}
              <input
                type="number"
                min={MIN_BPM}
                max={MAX_BPM}
                value={bpmText}
                onChange={(e) => setBpmText(e.target.value)}
                data-testid="sheet-bpm"
                style={{ width: '5em' }}
              />
            </label>
            <button type="button" onClick={onTap} data-testid="sheet-tap">
              {t('sheet.tap')}
            </button>
            <label>
              {t('sheet.timeSig')}{' '}
              <select value={timeSig} onChange={(e) => setTimeSig(e.target.value)} data-testid="sheet-timesig">
                {TIME_SIGNATURES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      )}
      <div className="controls">
        <button type="button" onClick={() => setPage(Math.max(0, pageIndex - 1))} disabled={pageIndex <= 0}>
          {t('sheet.prev')}
        </button>
        <span data-testid="sheet-page">{t('sheet.page', { page: pages.length ? pageIndex + 1 : 0, pages: pages.length })}</span>
        <button
          type="button"
          onClick={() => setPage(Math.min(pages.length - 1, pageIndex + 1))}
          disabled={pageIndex >= pages.length - 1}
        >
          {t('sheet.next')}
        </button>
        <label>
          {t('sheet.zoom')}{' '}
          <input
            type="range"
            min={20}
            max={80}
            step={5}
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
            data-testid="sheet-zoom"
          />
        </label>
        {loading && <span className="notice">{t('sheet.loading')}</span>}
      </div>
      {quantized.dropped > 0 && <p className="notice">{t('sheet.dropped', { count: quantized.dropped })}</p>}
      {result?.error && !loading && <p className="error">{t('sheet.error', { msg: result.error })}</p>}
      {/* SVG comes from Verovio rendering MusicXML we generated ourselves (text is escaped). */}
      <div className="sheet-pages" data-testid="sheet" dangerouslySetInnerHTML={{ __html: svg }} />
    </section>
  );
}
