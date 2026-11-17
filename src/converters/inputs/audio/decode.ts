/**
 * Browser-side decoding: any audio or video file the browser can decode → mono Float32Array at
 * 22,050 Hz (Basic Pitch's input rate). Uses decodeAudioData, which also reads the audio track
 * of video containers (mp4/webm/mov) where the browser supports the codec.
 */
import { BASIC_PITCH_SAMPLE_RATE } from './constants';

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

/** Averages all channels into one. */
export function downmix(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const len = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(len);
  for (const c of channels) for (let i = 0; i < len; i++) out[i]! += c[i]! / channels.length;
  return out;
}

export async function decodeToMono22k(file: Blob & { name?: string }, signal?: AbortSignal): Promise<Float32Array> {
  const Ctor = offlineContextCtor();
  if (!Ctor) {
    throw new AudioDecodeError('no-webaudio', 'This browser has no Web Audio support, so it cannot read audio files.');
  }
  const name = file.name ? `“${file.name}”` : 'this file';

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw new AudioDecodeError(
      'too-large',
      `${name} is too large to load in this browser. Try a shorter clip, or extract just the audio (MP3/WAV) first.`,
    );
  }
  throwIfAborted(signal);

  // decodeAudioData resamples to the context's rate, so a 22,050 Hz context does the resampling.
  let decoded: AudioBuffer;
  try {
    decoded = await new Ctor(1, 1, BASIC_PITCH_SAMPLE_RATE).decodeAudioData(bytes);
  } catch {
    throw new AudioDecodeError(
      'unsupported',
      `Your browser couldn't read the audio in ${name}. The format or codec may not be supported here ` +
        `(for example FLAC or MOV on some browsers), or the video has no sound track. ` +
        `Convert it to MP3 or WAV, or try Chrome or Firefox.`,
    );
  }
  throwIfAborted(signal);

  if (decoded.sampleRate !== BASIC_PITCH_SAMPLE_RATE) decoded = await renderAt22k(Ctor, decoded);

  const channels: Float32Array[] = [];
  for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c));
  const mono = downmix(channels);

  let peak = 0;
  for (let i = 0; i < mono.length; i++) peak = Math.max(peak, Math.abs(mono[i]!));
  if (mono.length === 0 || peak < 1e-4) {
    throw new AudioDecodeError('silent', `${name} has no audible sound to transcribe.`);
  }
  // Copy so the buffer can be transferred to the worker independently of the AudioBuffer.
  return mono === channels[0] ? mono.slice() : mono;
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
