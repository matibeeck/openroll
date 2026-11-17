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
- [ ] `Score`: notes {pitch 21–108, start/duration in seconds, velocity 0–1, hand 'L'|'R'|null, track}, tempo map, time signature, key (optional), title.
- [ ] Hand assignment: from track/staff names when present, else split at a configurable pitch (default C4) with simple voice continuity.
- [ ] MIDI import/export with @tonejs/midi (format 0 and 1, tempo changes).
- [ ] MusicXML/MXL import via Verovio (MusicXML → MIDI → Score).
- [ ] Fixtures generated in code: scales, chords, and a two-hand piece written note by note from a public-domain work (e.g. Minuet in G, BWV Anh. 114).

Accept: MIDI → Score → MIDI identical within 1 ms; MusicXML → Score matches the fixture's pitch/onset sequence.

## M2 — Practice mode
- [ ] Canvas renderer: 88-key keyboard, falling notes colored by hand, octave guides, note-name labels toggle (C D E / Do Re Mi).
- [ ] Transport: play/pause, seek, speed 25–150% without pitch change, A-B loop, hands selector (L / R / both).
- [ ] Audio with tone + Salamander samples (fallback: Tone.PolySynth).
- [ ] Web MIDI input: pressed keys highlighted, wait mode (pauses until the right notes are played), score (hits, misses, accuracy %).
- [ ] No-MIDI fallback: computer keyboard + on-screen keys; clear notice on Safari.

Accept: wait-mode and scoring logic unit-tested with simulated MIDI events; smooth playback of a 5-minute piece (record measured fps in REPORTE.md).

## M3 — Falling-notes video export
- [ ] Pure, deterministic `renderFrame(score, t, options)` (M5 reuses it to generate test videos).
- [ ] Export 720p/1080p at 30/60 fps with audio to WebM (canvas.captureStream + MediaRecorder + MediaStreamDestination). Options: dark/light theme, labels, hand colors.

Accept: e2e exports a 10-second clip; it plays and its duration is within ±0.2 s.

## M4 — Audio / performance video → notes
- [ ] Inputs: mp3, wav, ogg, flac, m4a, mp4, webm, mov; decode audio with decodeAudioData; clear error when the browser can't.
- [ ] Basic Pitch in a Web Worker (22,050 Hz mono), progress + cancel.
- [ ] Post-processing: min note length, merge fragments, velocity, hand assignment (M1).
- [ ] Round-trip test: synthesize audio from fixture Scores (OfflineAudioContext or a simple piano-like synth) → transcribe → note F1 (pitch exact, onset ±50 ms).

Accept: F1 ≥ 0.85 monophonic, ≥ 0.70 two-hand. If missed, record the numbers; better models are phase 2.

## M5 — Falling-notes video → notes
- [ ] Frame sampling (requestVideoFrameCallback or seek stepping) into a canvas.
- [ ] Keyboard calibration: auto-detect the keyboard strip and key positions; manual adjust (ends, 88/76/61 keys, lowest key).
- [ ] Detection: per key, compare against its idle color (and/or bars crossing a line just above the keys), debounce, emit note on/off, infer hand from color clusters.
- [ ] Round-trip test: fixture Scores → `renderFrame` (several themes/colors) → detector → F1; plus one encoded WebM from M3 in e2e.

Accept: F1 ≥ 0.95 on generated frames; manual calibration works.

## M6 — Score → sheet music
- [ ] Quantization: tempo from the file or user BPM + tap tempo; time signature; 1/16 grid; drop micro-notes; keep chords together.
- [ ] Two-staff piano MusicXML writer: rests, ties across barlines, chords, key signature (estimated from pitch histogram), title.
- [ ] Render with Verovio (SVG), page navigation, zoom; download MusicXML and MIDI.

Accept: quantization tests on known sequences; output loads in Verovio without errors; MusicXML → Score → MusicXML preserves pitches/onsets for the fixtures.

## M7 — Hub UI
- [ ] Home: one drop zone ("Drop anything: MIDI, MusicXML, audio, video") + file picker; auto-detect type; for videos ask "Falling-notes video or real performance?".
- [ ] Result screen tabs: Practice · Sheet · Video · Download.
- [ ] i18n English + Spanish; "everything stays on your device" notice.
- [ ] PWA: installable, works offline after the first load.

Accept: Playwright e2e for each flow (MIDI → practice, MusicXML → sheet, audio → MIDI download, falling-notes video → practice, video export), with screenshots in docs/screenshots/.

## M8 — Final QA and report
- [ ] `qa-reviewer` runs everything from a clean install and reviews against this plan and CLAUDE.md.
- [ ] Fix blockers and high-severity findings; re-run.
- [ ] Write REPORTE.md in Spanish:
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
- Transkun ONNX for more accurate piano transcription; live microphone input.
- MP4 export; native iPad wrapper (Web MIDI is missing on iOS).
- Optional AI extras (explain a piece, practice plans) — never required by core features.
