/**
 * Shared audio / performance-video pipeline (browser only):
 * decode + resample (main thread, native) → downmix, Basic Pitch, post-process (warm Web Worker)
 * → Score. The model warm-up starts in parallel with reading/decoding the file.
 */
import type { Score } from '../../../core/score';
import type { ProgressFn } from '../../types';
import { decodeAudioChannels, silentError } from './decode';
import { modelWindows } from './mono';
import type { PostprocessOptions } from './postprocess';
import { AudioProgress } from './progress';
import { currentWarmInfo, SilentAudioError, transcribeChannels, warmUp } from './transcriber';
import { epochNow, recordSpan } from './timing';

export { modelUrl, prewarmAudioTranscriber } from './transcriber';

export interface AudioConvertOptions {
  /** Overrides for the post-processing defaults (min length, merge gap, hand split…). */
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
