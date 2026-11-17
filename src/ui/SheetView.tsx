import { useEffect, useMemo, useRef, useState } from 'react';
import { isFreeTiming, quantize, tapTempo } from '../core/quantize';
import type { KeySignature, Score } from '../core/score';
import {
  autoKey,
  defaultSheetSettings,
  GRID_CHOICES,
  KEY_CHOICES,
  keyValue,
  MAX_BPM,
  MIN_BPM,
  parseTimeSig,
  quantizeOptions,
  sheetEstimate,
  tonicName,
  tsText,
  withTimeSig,
  type SheetSettings,
} from './sheetSettings';
import { isCompound } from '../converters/outputs/musicxml/layout';
import { quantizedToMusicXml } from '../converters/outputs/musicxml';
import { renderSheet, type SheetResult } from '../converters/outputs/sheet';
import { useI18n } from '../i18n';

const TIME_SIGNATURES = ['2/4', '3/4', '4/4', '5/4', '3/8', '6/8', '9/8', '12/8'];

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
export default function SheetView({
  score,
  settings,
  onSettings,
}: {
  score: Score;
  settings?: SheetSettings;
  onSettings?: (s: SheetSettings) => void;
}) {
  const free = useMemo(() => isFreeTiming(score), [score]);
  const { t, lang } = useI18n();
  const [localSettings, setLocalSettings] = useState(() => defaultSheetSettings(score, free));
  const current = settings ?? localSettings;
  const { bpmText, timeSig } = current;
  const simplify = current.simplify ?? false;
  const grid = current.grid ?? 'auto';
  const keyChoice = current.key ?? 'auto';
  const replace = (next: SheetSettings) => {
    setLocalSettings(next);
    onSettings?.(next);
  };
  const update = (patch: Partial<SheetSettings>) => replace({ ...current, ...patch });
  const setBpmText = (bpmText: string) => update({ bpmText });
  const setTimeSig = (ts: string) => replace(withTimeSig(score, current, ts));
  const estimate = useMemo(() => (free ? sheetEstimate(score) : null), [score, free]);
  const detected = useMemo(() => autoKey(score), [score]);
  const keyName = (k: KeySignature) =>
    t(k.mode === 'minor' ? 'sheet.key.minor' : 'sheet.key.major', { tonic: tonicName(k, lang === 'es') });
  // The tempo field counts the meter's beat: ♩. in 6/8, 9/8, 12/8; ♪ in 3/8; ♩ otherwise.
  const meter = parseTimeSig(timeSig);
  const beatUnit = isCompound(meter) ? '♩.' : meter.denominator === 8 ? '♪' : '♩';
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

  const quantized = useMemo(
    () => quantize(score, quantizeOptions(score, free, { bpmText, timeSig, simplify, grid, key: keyChoice })),
    [score, free, bpmText, timeSig, simplify, grid, keyChoice],
  );
  const xml = useMemo(() => quantizedToMusicXml(quantized), [quantized]);
  const request = useMemo<Request | null>(
    () => (width > 0 ? { xml, width, scale } : null),
    [xml, width, scale],
  );

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
          <p className="notice" data-testid="sheet-estimate">
            {estimate
              ? t('sheet.estimated', {
                  meter: tsText(estimate.timeSignature),
                  unit: isCompound(estimate.timeSignature) ? '♩.' : '♩',
                  bpm: Math.round(estimate.beatBpm),
                  key: keyName(detected.key),
                })
              : t('sheet.freeHint')}
          </p>
          <div className="controls">
            <label>
              {t('sheet.bpm', { unit: beatUnit })}{' '}
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
              <select
                value={timeSig}
                onChange={(e) => setTimeSig(e.target.value)}
                data-testid="sheet-timesig"
              >
                {TIME_SIGNATURES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('sheet.grid')}{' '}
              <select value={grid} onChange={(e) => update({ grid: e.target.value })} data-testid="sheet-grid">
                {GRID_CHOICES.map((g) => (
                  <option key={g} value={g}>
                    {g === 'auto' ? t('sheet.grid.auto') : `1/${g}`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={simplify}
                onChange={(e) => update({ simplify: e.target.checked })}
                data-testid="sheet-simplify"
              />{' '}
              {t('sheet.simplify')}
            </label>
          </div>
        </>
      )}
      <div className="controls">
        <label>
          {t('sheet.keySelect')}{' '}
          <select value={keyChoice} onChange={(e) => update({ key: e.target.value })} data-testid="sheet-key">
            <option value="auto">
              {t(detected.fromFile ? 'sheet.key.autoFile' : 'sheet.key.auto', { key: keyName(detected.key) })}
            </option>
            {KEY_CHOICES.map((k) => (
              <option key={keyValue(k)} value={keyValue(k)}>
                {keyName(k)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="controls">
        <button type="button" onClick={() => setPage(Math.max(0, pageIndex - 1))} disabled={pageIndex <= 0}>
          {t('sheet.prev')}
        </button>
        <span data-testid="sheet-page">
          {t('sheet.page', { page: pages.length ? pageIndex + 1 : 0, pages: pages.length })}
        </span>
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
