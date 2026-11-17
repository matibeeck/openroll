import type { Score } from '../core/score';
import { scoreToMidiBytes } from '../converters/outputs/midi/scoreToMidi';
import { MUSICXML_MIME, scoreToMusicXml } from '../converters/outputs/musicxml';
import { useI18n } from '../i18n';
import { isFreeTiming } from '../core/quantize';
import { downloadBlob, safeFileName } from './download';
import { defaultSheetSettings, quantizeOptions, type SheetSettings } from './sheetSettings';

/** Download tab: MIDI and MusicXML files generated on the device. */
export default function DownloadView({ score, settings }: { score: Score; settings?: SheetSettings }) {
  const { t } = useI18n();
  const base = safeFileName(score.title);

  const downloadMidi = () => {
    const bytes = scoreToMidiBytes(score);
    downloadBlob(new Blob([bytes.slice().buffer], { type: 'audio/midi' }), `${base}.mid`);
  };
  const downloadMusicXml = () => {
    const opts = quantizeOptions(isFreeTiming(score), settings ?? defaultSheetSettings(score));
    downloadBlob(new Blob([scoreToMusicXml(score, opts)], { type: MUSICXML_MIME }), `${base}.musicxml`);
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
