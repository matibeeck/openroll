import type { Score } from '../core/score';

export type ProgressFn = (fraction: number, label?: string) => void;

export interface InputConverter<Opts = Record<string, unknown>> {
  id: string;
  label: string;
  accepts: { extensions: string[]; mimeTypes: string[] };
  /** Optional content sniffing when the extension is ambiguous. */
  sniff?(file: File): Promise<boolean>;
  convert(file: File, opts: Opts, onProgress: ProgressFn, signal: AbortSignal): Promise<Score>;
}

export interface OutputConverter<Opts = Record<string, unknown>> {
  id: string;
  label: string;
  kind: 'view' | 'file';
  render?(score: Score, el: HTMLElement, opts: Opts): void | (() => void);
  export?(score: Score, opts: Opts): Promise<Blob>;
}
