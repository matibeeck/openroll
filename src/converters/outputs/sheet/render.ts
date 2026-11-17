/**
 * Verovio SVG rendering (pure given a toolkit). Runs inside the Verovio worker; also callable in
 * Node tests with a toolkit from src/core/verovio.ts.
 */
import type { VerovioToolkit } from '../../../core/verovio';

export interface SheetRenderOptions {
  /** Width in CSS pixels the pages should occupy. */
  width: number;
  /** Verovio scale in percent (zoom). Default 40. */
  scale?: number;
}

export interface SheetResult {
  pages: string[];
  pageCount: number;
}

/** Verovio layout options for a page `width` px wide at `scale` % (1 Verovio unit = scale/100 px). */
export function verovioOptions(opts: SheetRenderOptions): Record<string, string | number | boolean> {
  const scale = Math.min(150, Math.max(10, opts.scale ?? 40));
  const pageWidth = Math.min(60000, Math.max(500, Math.round((opts.width * 100) / scale)));
  return {
    scale,
    pageWidth,
    pageHeight: Math.round(pageWidth * 1.3),
    pageMarginLeft: 50,
    pageMarginRight: 50,
    pageMarginTop: 50,
    pageMarginBottom: 50,
    adjustPageHeight: true,
    breaks: 'auto',
    header: 'auto',
    footer: 'none',
    svgViewBox: false,
  };
}

/** Load MusicXML into `tk` and render every page to SVG. Throws when Verovio rejects the file. */
export function renderSheetWith(tk: VerovioToolkit, xml: string, opts: SheetRenderOptions): SheetResult {
  tk.setOptions(verovioOptions(opts));
  if (!tk.loadData(xml)) throw new Error(`Verovio could not read the sheet${tk.getLog() ? `: ${tk.getLog()}` : ''}`);
  const pageCount = tk.getPageCount();
  const pages: string[] = [];
  for (let i = 1; i <= pageCount; i++) pages.push(tk.renderToSVG(i));
  return { pages, pageCount };
}
