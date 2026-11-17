/**
 * Minimal software rasterizer implementing the Paint2D subset used by renderFrame.
 * fillText is a no-op. Lets Node tests render deterministic RGBA frames without native canvas.
 */
import type { Paint2D } from './render';

export function parseColor(c: string): [number, number, number] {
  const s = c.trim();
  if (s.startsWith('#')) {
    const h =
      s.length === 4
        ? s
            .slice(1)
            .split('')
            .map((x) => x + x)
            .join('')
        : s.slice(1, 7);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (m) {
    const [r, g, b] = m[1]!.split(',').map((x) => parseFloat(x));
    return [r ?? 0, g ?? 0, b ?? 0];
  }
  throw new Error(`Unsupported color: ${c}`);
}

export class RasterContext implements Paint2D {
  readonly data: Uint8ClampedArray;
  fillStyle: string = '#000000';
  font = '10px sans-serif';
  textAlign: CanvasTextAlign = 'left';
  textBaseline: CanvasTextBaseline = 'alphabetic';

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const [r, g, b] = parseColor(String(this.fillStyle));
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y1 = Math.min(this.height, Math.round(y + h));
    const d = this.data;
    for (let yy = y0; yy < y1; yy++) {
      let i = (yy * this.width + x0) * 4;
      for (let xx = x0; xx < x1; xx++, i += 4) {
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = 255;
      }
    }
  }

  fillText(): void {}

  pixel(x: number, y: number): [number, number, number] {
    const i = (Math.floor(y) * this.width + Math.floor(x)) * 4;
    return [this.data[i]!, this.data[i + 1]!, this.data[i + 2]!];
  }
}
