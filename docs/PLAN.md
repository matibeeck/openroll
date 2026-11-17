# MVP plan

Goal: a static web app where you drop a MIDI, MusicXML, audio file, performance video or falling-notes video and get (1) a practice view with falling notes and MIDI-keyboard input, (2) sheet music, (3) an exported falling-notes video, (4) MIDI/MusicXML downloads. All local, all free.

Per milestone: implement → tests → `npm run check` green → `qa-reviewer` pass on the milestone → commit → tick the boxes.

## M0 — Scaffold
- [x] Vite + React + TS (strict), ESLint, Prettier, Vitest, Playwright (Chromium), vite-plugin-pwa.
- [x] Scripts: dev, build, preview, typecheck, lint, test, test:e2e, licenses, check (= typecheck && lint && test && licenses).
- [x] `licenses`: fails if a production dependency has a license outside the allowlist in CLAUDE.md (free tool or a small script).
- [x] LICENSE (AGPL-3.0-only full text), README.md, README.es.md, CREDITS.md, .gitignore.
- [x] Layout: src/core, src/converters/{inputs,outputs}, src/workers, src/ui, src/i18n, tests/{unit,roundtrip,e2e,fixtures}.

Accept: `npm run check` and `npm run build` pass on the empty app.

## M1 — Score model + MIDI/MusicXML in
- [x] `Score`: notes {pitch 21–108, start/duration in seconds, velocity 0–1, hand 'L'|'R'|null, track}, tempo map, time signature, key (optional), title.
- [x] Hand assignment: from track/staff names when present, else split at a configurable pitch (default C4) with simple voice continuity.
- [x] MIDI import/export with @tonejs/midi (format 0 and 1, tempo changes).
- [x] MusicXML/MXL import via Verovio (MusicXML → MIDI → Score).
- [x] Fixtures generated in code: scales, chords, and a two-hand piece written note by note from a public-domain work (e.g. Minuet in G, BWV Anh. 114).

Accept: MIDI → Score → MIDI identical within 1 ms; MusicXML → Score matches the fixture's pitch/onset sequence.

## M2 — Practice mode
- [x] Canvas renderer: 88-key keyboard, falling notes colored by hand, octave guides, note-name labels toggle (C D E / Do Re Mi).
- [x] Transport: play/pause, seek, speed 25–150% without pitch change, A-B loop, hands selector (L / R / both).
- [x] Audio with tone + Salamander samples (fallback: Tone.PolySynth).
- [x] Web MIDI input: pressed keys highlighted, wait mode (pauses until the right notes are played), score (hits, misses, accuracy %).
- [x] No-MIDI fallback: computer keyboard + on-screen keys; clear notice on Safari.

Accept: wait-mode and scoring logic unit-tested with simulated MIDI events; smooth playback of a 5-minute piece (record measured fps in REPORTE.md).

## M3 — Falling-notes video export
- [x] Pure, deterministic `renderFrame(score, t, options)` (M5 reuses it to generate test videos).
- [x] Export 720p/1080p at 30/60 fps with audio to WebM (canvas.captureStream + MediaRecorder + MediaStreamDestination). Options: dark/light theme, labels, hand colors.

Accept: e2e exports a 10-second clip; it plays and its duration is within ±0.2 s.

## M4 — Audio / performance video → notes
- [x] Inputs: mp3, wav, ogg, flac, m4a, mp4, webm, mov; decode audio with decodeAudioData; clear error when the browser can't.
- [x] Basic Pitch in a Web Worker (22,050 Hz mono), progress + cancel.
- [x] Post-processing: min note length, merge fragments, velocity, hand assignment (M1).
- [x] Round-trip test: synthesize audio from fixture Scores (OfflineAudioContext or a simple piano-like synth) → transcribe → note F1 (pitch exact, onset ±50 ms).

Accept: F1 ≥ 0.85 monophonic, ≥ 0.70 two-hand. If missed, record the numbers; better models are phase 2.

## M5 — Falling-notes video → notes
- [x] Frame sampling (requestVideoFrameCallback or seek stepping) into a canvas.
- [x] Keyboard calibration: auto-detect the keyboard strip and key positions; manual adjust (ends, 88/76/61 keys, lowest key).
- [x] Detection: per key, compare against its idle color (and/or bars crossing a line just above the keys), debounce, emit note on/off, infer hand from color clusters.
- [x] Round-trip test: fixture Scores → `renderFrame` (several themes/colors) → detector → F1; plus one encoded WebM from M3 in e2e.

Accept: F1 ≥ 0.95 on generated frames; manual calibration works.

## M6 — Score → sheet music
- [x] Quantization: tempo from the file or user BPM + tap tempo; time signature; 1/16 grid; drop micro-notes; keep chords together.
- [x] Two-staff piano MusicXML writer: rests, ties across barlines, chords, key signature (estimated from pitch histogram), title.
- [x] Render with Verovio (SVG), page navigation, zoom; download MusicXML and MIDI.

Accept: quantization tests on known sequences; output loads in Verovio without errors; MusicXML → Score → MusicXML preserves pitches/onsets for the fixtures.

## M7 — Hub UI
- [x] Home: one drop zone ("Drop anything: MIDI, MusicXML, audio, video") + file picker; auto-detect type; for videos ask "Falling-notes video or real performance?".
- [x] Result screen tabs: Practice · Sheet · Video · Download.
- [x] i18n English + Spanish; "everything stays on your device" notice.
- [x] PWA: installable, works offline after the first load.

Accept: Playwright e2e for each flow (MIDI → practice, MusicXML → sheet, audio → MIDI download, falling-notes video → practice, video export), with screenshots in docs/screenshots/.

## M8 — Final QA and report
- [x] `qa-reviewer` runs everything from a clean install and reviews against this plan and CLAUDE.md.
- [x] Fix blockers and high-severity findings; re-run.
- [x] Write REPORTE.md in Spanish:
  1. Resumen (3–5 líneas)
  2. Qué funciona (por hito, con capturas)
  3. Qué no funciona o quedó a medias, y por qué
  4. Números: F1 audio→notas y video→notas, fps, tamaño del bundle
  5. Decisiones tomadas (de docs/DECISIONS.md)
  6. Licencias: dependencias y licencia de cada una; confirmación de que no hay nada prohibido
  7. Cómo probarlo (comandos exactos)
  8. Siguientes pasos (fase 2)

## Phase 2 — do NOT build now (list it in REPORTE.md)
- Sheet music photo/PDF → notes (OMR) as a separate service (e.g. a Hugging Face ZeroGPU Space); check model licenses first.
- ~~Transkun ONNX for more accurate piano transcription~~ (done in round 3, see below); live microphone input.
- MP4 export; native iPad wrapper (Web MIDI is missing on iOS).
- Optional AI extras (explain a piece, practice plans) — never required by core features.

## Round 3 — high-precision piano mode
- [x] Transkun (MIT) on onnxruntime-web in a worker (WebGPU, WASM fallback), model fetched at setup into `public/models/transkun/` (SHA-256), never precached; mode question fast vs high precision for audio and performance videos.
- [x] TS front end + semi-CRF Viterbi + segment stitching checked against the reference tensors (default suite) and the upstream PyTorch pipeline (opt-in `TRANSKUN=1`); e2e picks high precision and gets notes.
- [x] Compare both modes on the real recording and the evaluation fixtures (`npm run real-check:compare`); default stays fast (Basic Pitch), numbers in docs/DECISIONS.md.
