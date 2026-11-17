/** Transcription modes for audio and performance videos. Dependency-free (scripts import it too). */

/** `fast` = Basic Pitch (any instrument, small model); `precise` = Transkun (piano only, 86 MB once). */
export type TranscriptionMode = 'fast' | 'precise';

/** Mode offered first (primary button) and used when the caller does not choose one. */
export const DEFAULT_TRANSCRIPTION_MODE: TranscriptionMode = 'fast';
