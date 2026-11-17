# OpenRoll

Centro musical libre, de código abierto y local. Suelta un MIDI, un MusicXML, una grabación de audio, un video de una interpretación o un video de notas que caen, y obtén:

- una **vista de práctica** con notas que caen y entrada por teclado MIDI (modo espera, puntaje),
- **partitura** (piano a dos pentagramas, renderizada con Verovio),
- un **video de notas que caen** exportado (WebM),
- descargas **MIDI / MusicXML**.

Todo corre en tu navegador. Sin servidor, sin cuentas, sin claves de API. Tus archivos nunca salen de tu dispositivo.

## Formatos soportados

| Entrada | Extensiones |
|---|---|
| MIDI | .mid, .midi |
| MusicXML | .musicxml, .xml, .mxl |
| Audio | .mp3, .wav, .ogg, .flac, .m4a |
| Video de interpretación | .mp4, .webm, .mov (se transcribe el audio) |
| Video de notas que caen | .mp4, .webm, .mov (se calibra el teclado y se lee cuadro a cuadro) |

El audio y los videos de interpretación tienen dos modos:

- **Rápido** — [Basic Pitch](https://github.com/spotify/basic-pitch-ts) (cualquier instrumento, modelo de ~1 MB, unos segundos).
- **Alta precisión (piano)** — [Transkun](https://github.com/Yujia-Yan/Transkun) sobre onnxruntime-web (WebGPU, o WebAssembly si no hay): un modelo específico de piano que oye acordes más completos, además del pedal y la dinámica; más lento. Sus ~86 MB (modelo + runtime) se descargan del propio servidor de la app la primera vez que lo eliges y quedan guardados para usarlo sin conexión. `npm ci` / `npm run build` dejan el modelo en `public/models/transkun/` (`scripts/fetch-transkun.mjs`, verificado con SHA-256); la app nunca se conecta a otro servidor.

## Desarrollo

```bash
npm ci
npx playwright install chromium   # una vez, para e2e
npm run dev        # servidor de desarrollo
npm run check      # tipos + lint + tests unitarios/round-trip + auditoría de licencias
npm run test:e2e   # Playwright (Chromium)
npm run build      # build estático en dist/
TRANSKUN=1 npx vitest run tests/roundtrip/transkun.test.ts   # opcional: modo alta precisión con el modelo real
```

## Arquitectura

Toda entrada se convierte a un único `Score` canónico (`src/core/score.ts`); toda salida lee de `Score`. El trabajo pesado (inferencia ML, análisis de video) corre en Web Workers.

## Licencia

AGPL-3.0-only. Ver [LICENSE](LICENSE) y [CREDITS.md](CREDITS.md).
