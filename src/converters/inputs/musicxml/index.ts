import type { Score } from '../../../core/score';
import type { InputConverter, ProgressFn } from '../../types';
import { titleFromFileName } from '../midi';
// Only light, Verovio-free helpers are imported here. The conversion itself (musicXmlToScore)
// runs in the shared Verovio worker; importing it on this side would make the bundler emit a
// second copy of the 8 MB Verovio chunk. Tests import musicxmlToScore.ts directly.
import { decodeXml, isZip, MusicXmlParseError, type MusicXmlToScoreOptions } from './xml';
import { runVerovioJob } from '../../verovio-client';

export { MusicXmlParseError, type MusicXmlToScoreOptions } from './xml';

function abortError(): DOMException {
  return new DOMException('Conversion cancelled', 'AbortError');
}

export const musicXmlInput: InputConverter<MusicXmlToScoreOptions> = {
  id: 'musicxml',
  label: 'MusicXML',
  accepts: {
    extensions: ['.musicxml', '.mxl', '.xml'],
    mimeTypes: [
      'application/vnd.recordare.musicxml+xml',
      'application/vnd.recordare.musicxml',
      'application/xml',
      'text/xml',
    ],
  },
  /** True for an MXL container or XML whose root is score-partwise / score-timewise. */
  async sniff(file: File): Promise<boolean> {
    const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    if (isZip(head)) return /\.mxl$/i.test(file.name) || /META-INF\/container\.xml/.test(new TextDecoder('latin1').decode(head));
    return /<score-(partwise|timewise)\b/.test(decodeXml(head));
  },
  async convert(file: File, opts: MusicXmlToScoreOptions, onProgress: ProgressFn, signal: AbortSignal): Promise<Score> {
    if (signal.aborted) throw abortError();
    onProgress(0, 'reading');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (signal.aborted) throw abortError();
    onProgress(0.2, 'engraving');
    const title = titleFromFileName(file.name);
    let score: Score;
    try {
      score = await runVerovioJob(
        { type: 'musicxml-to-score', bytes, title, opts },
        { signal, transfer: [bytes.buffer], killOnAbort: true },
      );
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new MusicXmlParseError(e instanceof Error ? e.message : String(e));
    }
    if (signal.aborted) throw abortError();
    onProgress(1);
    return score;
  },
};
