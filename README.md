# OpenRoll

Free, open-source, local-first music hub. Drop a MIDI file, MusicXML, an audio recording, a performance video or a falling-notes video and get:

- a **practice view** with falling notes and MIDI-keyboard input (wait mode, scoring),
- **sheet music** (two-staff piano, rendered with Verovio),
- an exported **falling-notes video** (WebM),
- **MIDI / MusicXML** downloads.

Everything runs in your browser. No backend, no accounts, no API keys. Your files never leave your device.

## Supported formats

| Input | Extensions |
|---|---|
| MIDI | .mid, .midi |
| MusicXML | .musicxml, .xml, .mxl |
| Audio | .mp3, .wav, .ogg, .flac, .m4a |
| Performance video | .mp4, .webm, .mov (audio track is transcribed) |
| Falling-notes video | .mp4, .webm, .mov (keyboard is calibrated and read frame by frame) |

Audio and performance videos offer two modes:

- **Fast** — [Basic Pitch](https://github.com/spotify/basic-pitch-ts) (any instrument, ~1 MB model, a few seconds).
- **High precision (piano)** — [Transkun](https://github.com/Yujia-Yan/Transkun) on onnxruntime-web (WebGPU, or WebAssembly as fallback): a piano-specific model that hears fuller chords, plus sustain pedal and dynamics; slower. Its ~86 MB (model + runtime) are downloaded from the app's own server the first time you pick it, then cached for offline use. `npm ci` / `npm run build` put the model in `public/models/transkun/` (`scripts/fetch-transkun.mjs`, SHA-256 checked); the running app never contacts another host.

## Development

```bash
npm ci
npx playwright install chromium   # once, for e2e
npm run dev        # dev server
npm run check      # typecheck + lint + unit/round-trip tests + license audit
npm run test:e2e   # Playwright (Chromium)
npm run build      # static build in dist/
TRANSKUN=1 npx vitest run tests/roundtrip/transkun.test.ts   # opt-in: high-precision mode with the real model
```

## Architecture

Every input converts to one canonical `Score` (`src/core/score.ts`); every output reads from `Score`. Heavy work (ML inference, video analysis) runs in Web Workers.

## License

AGPL-3.0-only. See [LICENSE](LICENSE) and [CREDITS.md](CREDITS.md).
