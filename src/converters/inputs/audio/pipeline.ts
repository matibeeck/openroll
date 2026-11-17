/**
 * Shared audio / performance-video pipeline (browser only), two modes:
 * - fast (Basic Pitch): decode + resample to 22,050 Hz (main thread, native) → downmix, Basic Pitch,
 *   post-process (warm Web Worker) → Score. The model warm-up starts in parallel with decoding.
 * - precise (Transkun, piano): decode at 44,100 Hz → transkun.worker.ts (onnxruntime-web, WebGPU or
 *   WebAssembly) → Score. Its client, worker and runtime are loaded with import() on first use.
 */
import type { Score } from '../../../core/score';
import type { ProgressFn } from '../../types';
import { decodeAudioChannels, silentError } from './decode';
import { DEFAULT_TRANSCRIPTION_MODE, type TranscriptionMode } from './mode';
import { modelWindows } from './mono';
import type { PostprocessOptions } from './postprocess';
import { AudioProgress } from './progress';
import { currentWarmInfo, SilentAudioError, transcribeChannels, warmUp } from './transcriber';
import { epochNow, recordSpan } from './timing';
import { TK_SAMPLE_RATE } from './transkun/constants';
import { TranskunProgress } from './transkun/progress';
import { planSegments } from './transkun/segments';

export { modelUrl, prewarmAudioTranscriber } from './transcriber';

export { DEFAULT_TRANSCRIPTION_MODE, type TranscriptionMode } from './mode';

export interface AudioConvertOptions {
  mode?: TranscriptionMode;
  /** Overrides for the post-processing defaults of the fast mode (min length, merge gap, hand split…). */
  postprocess?: Partial<PostprocessOptions>;
}

function abortError(): DOMException {
  return new DOMException('Conversion cancelled', 'AbortError');
}

export function titleFromFileName(name: string): string {
  return name.replace(/\.[^./\\]+$/, '').trim() || 'Transcription';
}

export async function transcribeMediaFile(
  file: File,
  opts: AudioConvertOptions,
  onProgress: ProgressFn,
  signal: AbortSignal,
): Promise<Score> {
  if (signal.aborted) throw abortError();
  if ((opts.mode ?? DEFAULT_TRANSCRIPTION_MODE) === 'precise') return transcribePrecise(file, onProgress, signal);
  const t0 = epochNow();
  const progress = new AudioProgress(onProgress);
  progress.reading();
  // Overlap the model warm-up (cold: ~0.3–0.4 s on an M-series GPU, up to ~10 s when its shaders were never compiled on the machine) with reading and decoding.
  if (typeof Worker !== 'undefined') warmUp().catch(() => {});

  const { channels } = await decodeAudioChannels(file, signal, (s) => (s === 'reading' ? progress.reading() : progress.decoding()));
  if (signal.aborted) throw abortError();
  const warm = currentWarmInfo();
  progress.plan({ windows: modelWindows(channels[0]?.length ?? 0), windowMs: warm?.windowMs ?? null, modelPending: !warm });

  let result;
  try {
    result = await transcribeChannels(
      channels,
      { postprocess: { ...opts.postprocess, title: titleFromFileName(file.name) } },
      (stage, value) => progress.worker(stage, value),
      signal,
    );
  } catch (e) {
    if (e instanceof SilentAudioError) throw silentError(file);
    throw e;
  }
  for (const s of result.spans) recordSpan(s, { backend: result.backend });
  recordSpan({ stage: 'total', start: t0, end: epochNow() });
  progress.done();
  return result.score;
}

/** High-precision piano mode (Transkun). */
async function transcribePrecise(file: File, onProgress: ProgressFn, signal: AbortSignal): Promise<Score> {
  const t0 = epochNow();
  const progress = new TranskunProgress(onProgress);
  progress.reading();
  // Load the client chunk while the file is decoded (it creates the worker on first use).
  const clientChunk = import('./transkun/client');
  const { channels } = await decodeAudioChannels(
    file,
    signal,
    (s) => (s === 'reading' ? progress.reading() : progress.decoding()),
    TK_SAMPLE_RATE,
  );
  if (signal.aborted) throw abortError();
  const client = await clientChunk;
  const warm = client.transkunWarm();
  const cached = warm || (await client.isTranskunCached());
  progress.plan({
    segments: planSegments(channels[0]?.length ?? 0).starts.length,
    downloadBytes: cached ? 0 : client.TRANSKUN_TOTAL_BYTES,
    warm,
    gpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
  });
  let result;
  try {
    result = await client.transcribeWithTranskun(
      channels,
      titleFromFileName(file.name),
      (stage, value, done, total) => progress.worker(stage, value, done, total),
      signal,
    );
  } catch (e) {
    if (e instanceof client.TranskunSilentError) throw silentError(file);
    throw e;
  }
  recordSpan({ stage: 'total', start: t0, end: epochNow() }, { backend: result.backend, mode: 'precise' });
  progress.done();
  return result.score;
}
