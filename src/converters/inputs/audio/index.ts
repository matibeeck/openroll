import type { InputConverter } from '../../types';
import { transcribeMediaFile, type AudioConvertOptions } from './pipeline';

export { AudioDecodeError, type AudioDecodeErrorCode } from './decode';
export type { AudioConvertOptions } from './pipeline';
export { prewarmAudioTranscriber } from './transcriber';

/** Audio recording → Score via Basic Pitch (in a Web Worker) and post-processing. */
export const audioInput: InputConverter<AudioConvertOptions> = {
  id: 'audio',
  label: 'Audio recording',
  accepts: {
    extensions: ['.mp3', '.wav', '.ogg', '.oga', '.flac', '.m4a', '.aac', '.opus'],
    mimeTypes: [
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
      'audio/wave',
      'audio/ogg',
      'audio/flac',
      'audio/x-flac',
      'audio/mp4',
      'audio/x-m4a',
      'audio/aac',
      'audio/opus',
    ],
  },
  convert: (file, opts, onProgress, signal) => transcribeMediaFile(file, opts ?? {}, onProgress, signal),
};
