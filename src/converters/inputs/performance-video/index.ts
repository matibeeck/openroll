import type { InputConverter } from '../../types';
import { transcribeMediaFile, type AudioConvertOptions } from '../audio/pipeline';

/**
 * Video of a real performance → Score. Same pipeline as audio: decodeAudioData reads the
 * video's sound track (where the browser supports the container/codec); the picture is ignored.
 */
export const performanceVideoInput: InputConverter<AudioConvertOptions> = {
  id: 'performance-video',
  label: 'Performance video',
  accepts: {
    extensions: ['.mp4', '.webm', '.mov', '.m4v'],
    mimeTypes: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v'],
  },
  convert: (file, opts, onProgress, signal) => transcribeMediaFile(file, opts ?? {}, onProgress, signal),
};
