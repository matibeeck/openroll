/** Verovio-free MusicXML helpers, safe to import on the main thread. */

export interface MusicXmlToScoreOptions {
  /** Split pitch for staves whose hand cannot be inferred. Default 60 (C4). */
  splitPitch?: number;
}

export class MusicXmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MusicXmlParseError';
  }
}

/** True for a ZIP container (compressed MusicXML, .mxl). */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Decode XML bytes honoring a UTF-16/UTF-8 byte-order mark. */
export function decodeXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}
