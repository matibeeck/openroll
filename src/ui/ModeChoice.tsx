import { useEffect, useState } from 'react';
import { DEFAULT_TRANSCRIPTION_MODE, type TranscriptionMode } from '../converters/inputs/audio';
import { isTranskunCached, TRANSKUN_TOTAL_MB } from '../converters/inputs/audio/transkun/cache';
import { useI18n } from '../i18n';

/**
 * "How should OpenRoll listen?" for audio and performance videos: fast (Basic Pitch, any
 * instrument) or high precision (Transkun, piano; one-time download). The default mode is the
 * primary, focused button.
 */
export function ModeChoice({ onChoose, onCancel }: { onChoose(mode: TranscriptionMode): void; onCancel(): void }) {
  const { t } = useI18n();
  const [cached, setCached] = useState(false);
  useEffect(() => {
    let live = true;
    void isTranskunCached().then((c) => live && setCached(c));
    return () => {
      live = false;
    };
  }, []);
  const option = (mode: TranscriptionMode, title: string, hint: string) => (
    <button
      type="button"
      className={`mode-option ${mode === DEFAULT_TRANSCRIPTION_MODE ? 'primary' : ''}`}
      data-testid={`mode-${mode}`}
      autoFocus={mode === DEFAULT_TRANSCRIPTION_MODE}
      onClick={() => onChoose(mode)}
    >
      <strong>{title}</strong>
      <span>{hint}</span>
    </button>
  );
  return (
    <main className="dropzone">
      <h2>{t('mode.question')}</h2>
      <div className="mode-options">
        {option('fast', t('mode.fast'), t('mode.fast.hint'))}
        {option(
          'precise',
          t('mode.precise'),
          cached ? t('mode.precise.ready') : t('mode.precise.hint', { size: TRANSKUN_TOTAL_MB }),
        )}
      </div>
      <button type="button" onClick={onCancel}>
        {t('home.cancel')}
      </button>
    </main>
  );
}
