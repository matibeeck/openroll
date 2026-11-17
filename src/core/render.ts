/**
 * Pure, deterministic falling-notes frame renderer.
 * Used by the practice view, the video exporter (M3) and to generate test frames for
 * falling-notes video recognition (M5). Only uses fillStyle/fillRect/fillText so it can run
 * against a real canvas or the minimal software rasterizer in ./raster.ts.
 */
import type { Hand, Note, Score } from './score';
import { layoutKeyboard, noteName, type KeyboardLayout, type LabelStyle } from './keyboard';

export interface Paint2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
}

export type Theme = 'dark' | 'light';

export interface HandColors {
  L: string;
  R: string;
  none: string;
}

export const DEFAULT_HAND_COLORS: HandColors = { R: '#22c55e', L: '#3b82f6', none: '#eab308' };

export interface RenderOptions {
  width: number;
  height: number;
  theme: Theme;
  handColors: HandColors;
  /** Draw note-name labels on falling notes and C keys. */
  labels: boolean;
  labelStyle: LabelStyle;
  /** Seconds of music visible above the keyboard. */
  lookahead: number;
  /** Fraction of the height used by the keyboard. */
  keyboardRatio: number;
  /** Which hands to draw; notes of other hands are drawn dimmed. */
  hands: 'both' | 'L' | 'R';
  /** Extra pressed keys (e.g. live MIDI input), drawn in the "input" color. */
  pressed?: ReadonlySet<number>;
  low: number;
  high: number;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  width: 1280,
  height: 720,
  theme: 'dark',
  handColors: DEFAULT_HAND_COLORS,
  labels: false,
  labelStyle: 'letters',
  lookahead: 3,
  keyboardRatio: 0.18,
  hands: 'both',
  low: 21,
  high: 108,
};

interface Palette {
  bg: string;
  guide: string;
  white: string;
  black: string;
  gap: string;
  hitLine: string;
  text: string;
  input: string;
  dimmed: string;
}

const PALETTES: Record<Theme, Palette> = {
  dark: {
    bg: '#0f172a',
    guide: '#1e293b',
    white: '#f8fafc',
    black: '#111111',
    gap: '#64748b',
    hitLine: '#ef4444',
    text: '#0f172a',
    input: '#f97316',
    dimmed: '#334155',
  },
  light: {
    bg: '#f1f5f9',
    guide: '#cbd5e1',
    white: '#ffffff',
    black: '#1f2937',
    gap: '#94a3b8',
    hitLine: '#ef4444',
    text: '#0f172a',
    input: '#f97316',
    dimmed: '#cbd5e1',
  },
};

/** Seconds before a note's end at which its key is released (keeps repeated notes distinguishable). */
export function releaseGap(duration: number): number {
  return Math.min(0.04, duration * 0.25);
}

export function isSounding(n: Note, t: number): boolean {
  return t >= n.start && t < n.start + n.duration - releaseGap(n.duration);
}

export function handColor(hand: Hand, colors: HandColors): string {
  return hand === 'L' ? colors.L : hand === 'R' ? colors.R : colors.none;
}

/** Geometry helpers, exposed so recognizers/tests can locate the keyboard in a frame. */
export function frameGeometry(o: Pick<RenderOptions, 'width' | 'height' | 'keyboardRatio' | 'low' | 'high'>) {
  const kbH = Math.round(o.height * o.keyboardRatio);
  const kbTop = o.height - kbH;
  const layout: KeyboardLayout = layoutKeyboard(o.width, o.low, o.high);
  return { kbTop, kbH, blackH: Math.round(kbH * 0.62), layout };
}

/** First index with notes possibly visible at time t (binary search on start). */
function firstVisible(notes: Note[], from: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid]!.start < from) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function renderFrame(
  ctx: Paint2D,
  score: Score,
  t: number,
  options: Partial<RenderOptions> = {},
): void {
  const o: RenderOptions = { ...DEFAULT_RENDER_OPTIONS, ...options };
  const pal = PALETTES[o.theme];
  const { kbTop, kbH, blackH, layout } = frameGeometry(o);
  const pxPerSec = kbTop / o.lookahead;
  const notes = score.notes;
  const shown = (n: Note) => o.hands === 'both' || n.hand === o.hands || n.hand === null;

  // Background + octave guides (a line at every C).
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, o.width, kbTop);
  ctx.fillStyle = pal.guide;
  for (const k of layout.keys) if (k.pitch % 12 === 0) ctx.fillRect(Math.round(k.x), 0, 1, kbTop);

  // Notes that may be visible: started at most `maxDur` ago. Scores are sorted by start.
  let maxDur = 0;
  for (const n of notes) if (n.duration > maxDur) maxDur = n.duration;
  const tEnd = t + o.lookahead;
  const active = new Map<number, string>();
  const labelFont = `${Math.max(9, Math.round(layout.whiteWidth * 0.55))}px sans-serif`;
  // Draw white-key notes first, then black-key notes on top.
  for (const pass of [false, true]) {
    for (let i = firstVisible(notes, t - maxDur); i < notes.length; i++) {
      const n = notes[i]!;
      if (n.start > tEnd) break;
      const key = layout.byPitch.get(n.pitch);
      if (!key || key.black !== pass) continue;
      const end = n.start + n.duration;
      if (end <= t) continue;
      const visible = shown(n);
      const color = visible ? handColor(n.hand, o.handColors) : pal.dimmed;
      const yBottom = kbTop - (n.start - t) * pxPerSec;
      const yTop = kbTop - (end - t) * pxPerSec;
      const top = Math.max(0, yTop);
      const bottom = Math.min(kbTop, yBottom);
      if (bottom > top) {
        const inset = Math.max(1, key.width * 0.08);
        ctx.fillStyle = color;
        ctx.fillRect(key.x + inset, top, key.width - 2 * inset, Math.max(1, bottom - top - 1));
        if (o.labels && bottom - top > 14) {
          ctx.fillStyle = pal.text;
          ctx.font = labelFont;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(noteName(n.pitch, o.labelStyle), key.x + key.width / 2, bottom - 3);
        }
      }
      if (visible && isSounding(n, t)) active.set(n.pitch, color);
    }
  }

  // Hit line.
  ctx.fillStyle = pal.hitLine;
  ctx.fillRect(0, kbTop - 2, o.width, 2);

  // Keyboard: whites, gaps, then blacks.
  for (const k of layout.keys) {
    if (k.black) continue;
    ctx.fillStyle = active.get(k.pitch) ?? (o.pressed?.has(k.pitch) ? pal.input : pal.white);
    ctx.fillRect(k.x, kbTop, k.width, kbH);
    ctx.fillStyle = pal.gap;
    ctx.fillRect(k.x, kbTop, 1, kbH);
  }
  for (const k of layout.keys) {
    if (!k.black) continue;
    ctx.fillStyle = active.get(k.pitch) ?? (o.pressed?.has(k.pitch) ? pal.input : pal.black);
    ctx.fillRect(k.x, kbTop, k.width, blackH);
  }
  if (o.labels) {
    ctx.fillStyle = pal.text;
    ctx.font = labelFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const k of layout.keys) {
      if (k.pitch % 12 === 0)
        ctx.fillText(noteName(k.pitch, o.labelStyle, true), k.x + k.width / 2, kbTop + kbH - 4);
    }
  }
}
