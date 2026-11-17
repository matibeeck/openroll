/**
 * Manual keyboard calibration for falling-notes videos: shows the idle frame with the keyboard
 * outline and key lines; the user drags the left/right ends (or types values) and picks the
 * keyboard size and lowest key.
 *
 * Wiring: `const { dialog, calibrate } = useCalibrationPrompt();` render `{dialog}` and pass
 * `{ calibrate }` as the falling-notes-video converter options.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { isBlack, layoutKeyboard, noteName } from '../core/keyboard';
import {
  highestKey,
  STANDARD_LOWEST,
  type CalibratePrompt,
  type Calibration,
  type KeyCount,
  type ManualCalibration,
} from '../converters/inputs/falling-notes-video';
import { useI18n } from '../i18n';

const KEY_COUNTS: KeyCount[] = [88, 76, 61];
/** White keys offered as the lowest key: A0 … C4. */
const LOWEST_CHOICES = Array.from({ length: 60 - 21 + 1 }, (_, i) => 21 + i).filter((p) => !isBlack(p));

function initialValues(frame: ImageData, auto: Calibration | null): ManualCalibration {
  if (!auto) {
    return { left: 0, right: frame.width, top: Math.round(frame.height * 0.82), bottom: frame.height, keys: 88, lowest: 21 };
  }
  const n = auto.high - auto.low + 1;
  const keys: KeyCount = n >= 82 ? 88 : n >= 68 ? 76 : 61;
  return {
    left: Math.round(auto.left),
    right: Math.round(auto.right),
    top: Math.round(auto.top),
    bottom: Math.round(auto.bottom),
    keys,
    lowest: auto.low,
  };
}

export interface CalibrationDialogProps {
  frame: ImageData;
  auto: Calibration | null;
  onDone(values: ManualCalibration): void;
  onCancel(): void;
}

export function CalibrationDialog({ frame, auto, onDone, onCancel }: CalibrationDialogProps) {
  const { t } = useI18n();
  const [v, setV] = useState<ManualCalibration>(() => initialValues(frame, auto));
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<'left' | 'right' | null>(null);
  const lowest = v.lowest ?? STANDARD_LOWEST[v.keys];

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.putImageData(frame, 0, 0);
    const top = v.top ?? 0;
    const bottom = v.bottom ?? frame.height;
    const layout = layoutKeyboard(v.right - v.left, lowest, highestKey(v.keys, lowest), v.left);
    ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
    for (const k of layout.keys) {
      if (k.black) ctx.fillRect(k.x + k.width / 2 - 1, top, 2, (bottom - top) * 0.3);
      else ctx.fillRect(k.x, top + (bottom - top) * 0.6, 1, (bottom - top) * 0.4);
    }
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = Math.max(2, frame.width / 400);
    ctx.strokeRect(v.left, top, v.right - v.left, bottom - top);
    // Drag handles.
    ctx.fillStyle = '#ef4444';
    const hw = Math.max(6, frame.width / 120);
    for (const x of [v.left, v.right]) ctx.fillRect(x - hw / 2, top - hw * 2, hw, hw * 2);
  }, [frame, v, lowest]);

  const toFrameX = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.round(((e.clientX - r.left) / r.width) * frame.width);
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const x = toFrameX(e);
    dragRef.current = Math.abs(x - v.left) <= Math.abs(x - v.right) ? 'left' : 'right';
    e.currentTarget.setPointerCapture(e.pointerId);
    setEnd(dragRef.current, x);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) setEnd(dragRef.current, toFrameX(e));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };
  const setEnd = (which: 'left' | 'right', x: number) =>
    setV((p) =>
      which === 'left'
        ? { ...p, left: Math.max(0, Math.min(x, p.right - 10)) }
        : { ...p, right: Math.min(frame.width, Math.max(x, p.left + 10)) },
    );
  const num = (key: 'left' | 'right' | 'top' | 'bottom', max: number) => (
    <label>
      {t(`calibrate.${key}`)}{' '}
      <input
        type="number"
        min={0}
        max={max}
        value={v[key] ?? 0}
        onChange={(e) => {
          const n = Math.max(0, Math.min(max, Math.round(Number(e.target.value) || 0)));
          setV((p) => ({ ...p, [key]: n }));
        }}
        style={{ width: '5.5em' }}
      />
    </label>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="calibration-title"
      data-testid="calibration-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 20,
        padding: 16,
      }}
    >
      <div
        style={{
          background: 'var(--panel, #111827)',
          border: '1px solid var(--line, #1f2937)',
          borderRadius: 12,
          padding: 16,
          width: 'min(960px, 100%)',
          maxHeight: '100%',
          overflow: 'auto',
        }}
      >
        <h2 id="calibration-title" style={{ marginTop: 0 }}>
          {t('calibrate.title')}
        </h2>
        {(!auto || auto.confidence < 0.85) && <p className="notice">{t('calibrate.unsure')}</p>}
        <p style={{ color: 'var(--muted, #9ca3af)' }}>{t('calibrate.hint')}</p>
        <canvas
          ref={canvasRef}
          width={frame.width}
          height={frame.height}
          data-testid="calibration-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ width: '100%', height: 'auto', touchAction: 'none', cursor: 'ew-resize', borderRadius: 6 }}
        />
        <div className="controls" style={{ flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
          {num('left', frame.width)}
          {num('right', frame.width)}
          {num('top', frame.height)}
          {num('bottom', frame.height)}
          <label>
            {t('calibrate.keys')}{' '}
            <select
              value={v.keys}
              onChange={(e) => {
                const keys = Number(e.target.value) as KeyCount;
                setV((p) => ({ ...p, keys, lowest: STANDARD_LOWEST[keys] }));
              }}
            >
              {KEY_COUNTS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('calibrate.lowest')}{' '}
            <select value={lowest} onChange={(e) => setV((p) => ({ ...p, lowest: Number(e.target.value) }))}>
              {LOWEST_CHOICES.map((p) => (
                <option key={p} value={p}>
                  {noteName(p, 'letters', true)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="controls" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" onClick={onCancel}>
            {t('calibrate.cancel')}
          </button>
          <button type="button" className="primary" onClick={() => onDone({ ...v, lowest })} data-testid="calibrate-ok">
            {t('calibrate.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface Pending {
  frame: ImageData;
  auto: Calibration | null;
  resolve(v: ManualCalibration): void;
  reject(e: unknown): void;
}

/** Hook that turns the dialog into a `calibrate` callback for the converter options. */
export function useCalibrationPrompt(): { dialog: ReactNode; calibrate: CalibratePrompt } {
  const [pending, setPending] = useState<Pending | null>(null);
  const calibrate = useCallback<CalibratePrompt>(
    (frame, auto) => new Promise<ManualCalibration>((resolve, reject) => setPending({ frame, auto, resolve, reject })),
    [],
  );
  const dialog = pending ? (
    <CalibrationDialog
      frame={pending.frame}
      auto={pending.auto}
      onDone={(v) => {
        setPending(null);
        pending.resolve(v);
      }}
      onCancel={() => {
        setPending(null);
        pending.reject(new DOMException('Calibration cancelled', 'AbortError'));
      }}
    />
  ) : null;
  return { dialog, calibrate };
}
