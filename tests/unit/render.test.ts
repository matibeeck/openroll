import { describe, expect, it } from 'vitest';
import { createScore } from '../../src/core/score';
import { isBlack, layoutKeyboard } from '../../src/core/keyboard';
import { DEFAULT_HAND_COLORS, frameGeometry, renderFrame } from '../../src/core/render';
import { parseColor, RasterContext } from '../../src/core/raster';

const score = createScore({
  notes: [
    { pitch: 60, start: 0, duration: 1, velocity: 0.8, hand: 'R', track: 0 },
    { pitch: 61, start: 0.5, duration: 1, velocity: 0.8, hand: 'L', track: 0 },
    { pitch: 48, start: 2, duration: 1, velocity: 0.8, hand: 'L', track: 0 },
  ],
});

describe('keyboard layout', () => {
  it('has 88 keys with 52 whites spanning the width', () => {
    const l = layoutKeyboard(1040);
    expect(l.keys).toHaveLength(88);
    expect(l.keys.filter((k) => !k.black)).toHaveLength(52);
    expect(l.whiteWidth).toBeCloseTo(20);
    expect(isBlack(61)).toBe(true);
    expect(isBlack(60)).toBe(false);
  });
});

describe('renderFrame', () => {
  const opts = { width: 520, height: 300 };
  const geo = frameGeometry({ ...opts, keyboardRatio: 0.18, low: 21, high: 108 });
  const keyY = (black: boolean) => (black ? geo.kbTop + geo.blackH / 2 : geo.kbTop + geo.kbH - 5);

  it('is deterministic', () => {
    const a = new RasterContext(opts.width, opts.height);
    const b = new RasterContext(opts.width, opts.height);
    renderFrame(a, score, 0.7, opts);
    renderFrame(b, score, 0.7, opts);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
  });

  it('lights sounding keys with the hand color and leaves others idle', () => {
    const ctx = new RasterContext(opts.width, opts.height);
    renderFrame(ctx, score, 0.7, opts);
    const c4 = geo.layout.byPitch.get(60)!;
    const cs4 = geo.layout.byPitch.get(61)!;
    const c3 = geo.layout.byPitch.get(48)!;
    expect(ctx.pixel(c4.x + c4.width / 2, keyY(false))).toEqual(parseColor(DEFAULT_HAND_COLORS.R));
    expect(ctx.pixel(cs4.x + cs4.width / 2, keyY(true))).toEqual(parseColor(DEFAULT_HAND_COLORS.L));
    expect(ctx.pixel(c3.x + c3.width / 2, keyY(false))).toEqual(parseColor('#f8fafc'));
  });

  it('draws upcoming notes above the hit line', () => {
    const ctx = new RasterContext(opts.width, opts.height);
    renderFrame(ctx, score, 0.7, opts);
    const c3 = geo.layout.byPitch.get(48)!;
    // C3 starts at 2.0s, lookahead 3s → its bottom edge is (2.0-0.7)/3 of the way up.
    const y = geo.kbTop - ((2.0 - 0.7) / 3) * geo.kbTop - 5;
    expect(ctx.pixel(c3.x + c3.width / 2, y)).toEqual(parseColor(DEFAULT_HAND_COLORS.L));
  });
});

describe('labels and octave guides', () => {
  class Recorder {
    fillStyle = '';
    font = '';
    textAlign: CanvasTextAlign = 'left';
    textBaseline: CanvasTextBaseline = 'alphabetic';
    texts: string[] = [];
    rects: { x: number; w: number; h: number; style: string }[] = [];
    fillRect(x: number, _y: number, w: number, h: number) {
      this.rects.push({ x, w, h, style: String(this.fillStyle) });
    }
    fillText(t: string) {
      this.texts.push(t);
    }
  }
  const opts = { width: 1040, height: 600 };

  it('draws no labels when off, letters or solfège when on', () => {
    const off = new Recorder();
    renderFrame(off, score, 0.2, opts);
    expect(off.texts).toEqual([]);
    const letters = new Recorder();
    renderFrame(letters, score, 0.2, { ...opts, labels: true, labelStyle: 'letters' });
    expect(letters.texts).toContain('C'); // falling C4
    expect(letters.texts).toContain('C4'); // keyboard label
    const solfege = new Recorder();
    renderFrame(solfege, score, 0.2, { ...opts, labels: true, labelStyle: 'solfege' });
    expect(solfege.texts).toContain('Do');
    expect(solfege.texts).toContain('Do4');
    expect(solfege.texts).not.toContain('C');
  });

  it('draws one octave guide per C (8 on an 88-key keyboard)', () => {
    const r = new Recorder();
    renderFrame(r, score, 0.2, opts);
    const guides = r.rects.filter((x) => x.w === 1 && x.style === '#1e293b');
    expect(guides).toHaveLength(8);
  });
});
