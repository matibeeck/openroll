/**
 * Browser-side decoding: any audio or video file the browser can decode → channels at 22,050 Hz
 * (Basic Pitch's input rate). decodeAudioData demuxes containers (mp4/webm/mov) and decodes only
 * their audio stream — video frames are never decoded (24 s of 1080p HEVC: ~35 ms) — and
 * resamples to the context rate.
 *
 * Main-thread cost is kept to native calls and one memcpy per channel: downmixing and the
 * silence check run in the worker (see transcriber.ts).
 */
import { BASIC_PITCH_SAMPLE_RATE } from './constants';
import { downmix, peakLevel, SILENCE_PEAK } from './mono';
import { timed } from './timing';

export { downmix } from './mono';

export type AudioDecodeErrorCode = 'no-webaudio' | 'unsupported' | 'silent' | 'too-large';

/** Errors with a stable `code` (for i18n) and a user-facing English message. */
export class AudioDecodeError extends Error {
  constructor(
    readonly code: AudioDecodeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AudioDecodeError';
  }
}

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

function offlineContextCtor(): OfflineCtor | undefined {
  const g = globalThis as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  return g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Conversion cancelled', 'AbortError');
}

export function displayName(file: { name?: string }): string {
  return file.name ? `“${file.name}”` : 'this file';
}

export function silentError(file: { name?: string }): AudioDecodeError {
  return new AudioDecodeError('silent', `${displayName(file)} has no audible sound to transcribe.`);
}

export interface DecodedAudio {
  /** One array per channel at 22,050 Hz, owned by the caller (transferable). */
  channels: Float32Array[];
  /** Seconds. */
  duration: number;
}

/**
 * Reads and decodes `file` to 22,050 Hz channels. `onStage` reports 'reading' then 'decoding'.
 * Throws AudioDecodeError for unsupported/oversized files and AbortError when cancelled.
 */
export async function decodeAudioChannels(
  file: Blob & { name?: string },
  signal?: AbortSignal,
  onStage: (stage: 'reading' | 'decoding') => void = () => {},
): Promise<DecodedAudio> {
  const Ctor = offlineContextCtor();
  if (!Ctor) {
    throw new AudioDecodeError('no-webaudio', 'This browser has no Web Audio support, so it cannot read audio files.');
  }
  const name = displayName(file);

  onStage('reading');
  let bytes: ArrayBuffer;
  try {
    bytes = await timed('file-read', () => file.arrayBuffer());
  } catch {
    throw new AudioDecodeError(
      'too-large',
      `${name} is too large to load in this browser. Try a shorter clip, or extract just the audio (MP3/WAV) first.`,
    );
  }
  throwIfAborted(signal);

  // decodeAudioData resamples to the context's rate, so a 22,050 Hz context does the resampling.
  onStage('decoding');
  let decoded: AudioBuffer;
  try {
    decoded = await timed('decode', () => new Ctor(1, 1, BASIC_PITCH_SAMPLE_RATE).decodeAudioData(bytes));
  } catch {
    throw new AudioDecodeError(
      'unsupported',
      `Your browser couldn't read the audio in ${name}. The format or codec may not be supported here ` +
        `(for example FLAC or MOV on some browsers), or the video has no sound track. ` +
        `Convert it to MP3 or WAV, or try Chrome or Firefox.`,
    );
  }
  throwIfAborted(signal);

  if (decoded.sampleRate !== BASIC_PITCH_SAMPLE_RATE) {
    const src = decoded;
    decoded = await timed('resample', () => renderAt22k(Ctor, src));
  }

  // Copies (memcpy) so the buffers can be transferred to the worker independently of the AudioBuffer.
  const channels: Float32Array[] = [];
  for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c).slice());
  return { channels, duration: decoded.duration };
}

/**
 * Mono 22,050 Hz in one call (kept for callers outside the converter). Runs the downmix and the
 * silence check on the calling thread; the converter does those in the worker instead.
 */
export async function decodeToMono22k(file: Blob & { name?: string }, signal?: AbortSignal): Promise<Float32Array> {
  const { channels } = await decodeAudioChannels(file, signal);
  const mono = downmix(channels);
  if (mono.length === 0 || peakLevel(mono) < SILENCE_PEAK) throw silentError(file);
  return mono;
}

/** Fallback resampler for browsers that ignore the context rate in decodeAudioData. */
async function renderAt22k(Ctor: OfflineCtor, buffer: AudioBuffer): Promise<AudioBuffer> {
  const length = Math.ceil(buffer.duration * BASIC_PITCH_SAMPLE_RATE);
  const ctx = new Ctor(1, Math.max(1, length), BASIC_PITCH_SAMPLE_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}
