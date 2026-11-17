# OpenRoll (working name)

Free, open-source, local-first music hub. Convert between MIDI, sheet music (MusicXML), audio, real performance videos and falling-notes videos, and practice with falling notes + a MIDI keyboard. Runs 100% in the browser: no backend, no accounts, no API keys, no paid services.

## Architecture — the one rule that matters

Every input converts to ONE canonical `Score`; every output reads from `Score`. N inputs + M outputs, never N×M converters.

    inputs:  midi · musicxml · audio · performance-video · falling-notes-video
                                   ↓
                         Score  (src/core/score.ts)
                                   ↓
    outputs: practice · sheet · video-export · midi-file · musicxml-file

- Heavy work (ML inference, video frame analysis) runs in Web Workers. The UI thread never blocks.
- Converters register in `src/converters/registry.ts`. To add one, follow the `add-converter` skill.

## Stack (don't swap without a line in docs/DECISIONS.md)

- Vite + React + TypeScript (strict). Canvas 2D for falling notes (WebGL only if profiling demands it).
- `@tonejs/midi` for MIDI I/O · `tone` for audio, with Salamander Grand Piano samples (CC-BY 3.0, credited in CREDITS.md) served from `public/`.
- `verovio` (WASM) for MusicXML → MIDI and notation rendering. LGPL-3.0: keep it an unmodified, separately loaded module.
- `@spotify/basic-pitch` (Apache-2.0) for audio → notes, inside a worker. Model files served from `public/`, never from a CDN at runtime.
- Transkun (MIT) on `onnxruntime-web` (MIT) for the opt-in high-precision piano mode. Its ~57 MB model is never committed: `scripts/fetch-transkun.mjs` (postinstall/predev/prebuild) downloads it from Hugging Face at a pinned revision, checks SHA-256 and puts it in `public/models/transkun/` (gitignored), so the app still serves it from its own origin. The fetch is strict (fails the build) when `CI=true` or `VERCEL=1`. Large binaries never go in git.
- Plain canvas pixel sampling for falling-notes video → notes (OpenCV.js only if truly needed).
- Web MIDI API with a computer-keyboard fallback (Safari/iOS have no Web MIDI).
- Vitest (unit + round-trip) · Playwright (e2e, Chromium) · vite-plugin-pwa.

## Commands

- `npm run dev` · `npm run build`
- `npm run check` = typecheck + lint + vitest + license audit. Must pass before every commit (`verify` skill).
- `npm run test:e2e` = Playwright.

## Licensing (hard rules)

- Project license: AGPL-3.0-only.
- Allowed deps: MIT, ISC, BSD-2/3, Apache-2.0, MPL-2.0, LGPL (unmodified, separately loaded), CC0 / CC-BY assets with credit.
- Forbidden: copying GPL code into the repo; non-commercial weights (e.g. MuScriptor, CC-BY-NC); Llama-licensed models (e.g. LEGATO OMR) in the app; anything paid, metered or needing an API key or account.
- Check a dependency's license before installing it. The license audit in `npm run check` must fail on forbidden licenses.
- Never use the trademark "Synthesia" in names, UI branding or logos. Descriptive use in docs is fine ("Synthesia-style videos").
- Fixtures: generate your own note data. Never commit copyrighted recordings, scores or videos, nor the owner's private recordings or anything derived from them (screenshots, MIDI, note lists); real-recording checks take the path from `REAL_RECORDING` and write their output to the OS temp folder.

## Quality bar

- Every converter ships with a round-trip test that prints its accuracy (note F1, onset tolerance).
- Targets: Chrome/Edge/Firefox desktop; Safari works without MIDI input. Smooth falling notes on a 5-minute piece.
- No network calls at runtime except loading the app itself.

## How to work here

- Follow docs/PLAN.md milestone by milestone and tick boxes as you finish.
- Don't stop to ask the user. Pick the most reasonable option and log it in docs/DECISIONS.md (date, decision, why, alternatives).
- Delegate: music logic → `music-core`; audio/video recognition → `transcription`; independent checks → `qa-reviewer` (it never reviews its own work).
- If a user-level subagent that delegates to Codex CLI exists, use it for mechanical work (boilerplate, repetitive fixtures) to save tokens.
- Commit after each milestone (Conventional Commits). Never push, add remotes or rewrite history.
- Blocked after 3 genuinely different attempts → document what and why, then move on.
- Docs: README.md in English plus README.es.md. The report REPORTE.md is in Spanish and local only (gitignored, never committed); keep updating it on disk.
