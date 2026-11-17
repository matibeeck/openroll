---
name: add-converter
description: Recipe for adding an input converter (file or recording → Score) or an output converter (Score → view or file) to the hub, with registry entry, worker, round-trip test, fixtures, UI wiring and docs. Use whenever a new format or conversion is added.
---

Every format goes through the canonical Score (src/core/score.ts). Never convert format A to format B directly.

## Input converter (something → Score)
1. Create `src/converters/inputs/<name>/index.ts` implementing `InputConverter`:
   `{ id, label, accepts: { extensions, mimeTypes }, sniff?(file): Promise<boolean>, convert(file, opts, onProgress, signal): Promise<Score> }`
2. Anything heavy (ML, video frames, > 50 ms of CPU) goes in `src/workers/<name>.worker.ts`; the converter only posts messages. Honor `signal` (cancel) and report `onProgress` (0–1).
3. Register it in `src/converters/registry.ts`.

## Output converter (Score → something)
1. Create `src/converters/outputs/<name>/index.ts` implementing `OutputConverter`:
   `{ id, label, kind: 'view' | 'file', render?(score, el, opts), export?(score, opts): Promise<Blob> }`
2. Register it in `src/converters/registry.ts`.

## Tests (required)
- Fixtures: note data generated in code (`tests/fixtures/*.ts`). No copyrighted recordings, scores or videos.
- Round-trip test in `tests/roundtrip/<name>.test.ts`: fixture Score → output or synthetic input → converter → note-level F1 (pitch exact, onset ±50 ms). For lossless formats require identity instead.
- Print the metric and assert the threshold from docs/PLAN.md. Never lower a threshold to pass; record misses in REPORTE.md.
- If the converter has UI, add or extend a Playwright spec in `tests/e2e/`.

## Wiring and docs
- Add the UI entry (drop-zone detection or a result tab) and the EN/ES strings in `src/i18n/`.
- Check the license of any new dependency against CLAUDE.md before installing it.
- Add the format to README.md (supported formats). If you chose between alternatives, add a line to docs/DECISIONS.md.
- Run the `verify` skill, then commit: `feat(<name>): …`.
