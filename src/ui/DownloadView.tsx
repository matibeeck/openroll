import type { Score } from '../core/score';
import { scoreToMidiBytes } from '../converters/outputs/midi/scoreToMidi';
import { MUSICXML_MIME, scoreToMusicXml } from '../converters/outputs/musicxml';
import { useI18n } from '../i18n';
import { downloadBlob, safeFileName } from './download';

/** Download tab: MIDI and MusicXML files generated on the device. */
export default function DownloadView({ score }: { score: Score }) {
  const { t } = useI18n();
  const base = safeFileName(score.title);

  const downloadMidi = () => {
    const bytes = scoreToMidiBytes(score);
    downloadBlob(new Blob([bytes.slice().buffer], { type: 'audio/midi' }), `${base}.mid`);
  };
  const downloadMusicXml = () => {
    downloadBlob(new Blob([scoreToMusicXml(score)], { type: MUSICXML_MIME }), `${base}.musicxml`);
  };

  return (
    <section className="download" aria-label="download">
      <div className="controls">
        <button type="button" className="primary" onClick={downloadMidi} data-testid="download-midi">
          {t('download.midi')}
        </button>
        <button type="button" className="primary" onClick={downloadMusicXml} data-testid="download-musicxml">
          {t('download.musicxml')}
        </button>
      </div>
      <p className="notice">{t('download.hint')}</p>
    </section>
  );
}
