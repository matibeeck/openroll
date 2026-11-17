# Real-file checks (local only)

Checks that use real recordings on this machine. They are **not** part of `npm run test:e2e` or CI,
and the media is **never** copied into the repo or committed (copyright, size). Generated files go
to the OS temp dir (`$TMPDIR/openroll-real-check/`).

All runs use real Google Chrome (`channel: 'chrome'`): Playwright's bundled Chromium may lack AAC/HEVC.

## Conversion speed — `scripts/real-check/speed/`

Wall time of audio / performance-video → notes in the **built** app, cold (first conversion after
page load, freshly launched browser) and warm (same page), with the per-stage breakdown (User
Timing measures `openroll:audio:*`), main-thread long tasks, the progress curve and the note
output (MIDI download; F1 against the reference for the synthetic WAV).

```bash
# REAL_RECORDING (as "Real performance"; skipped when unset) + a generated 60 s two-hand WAV
REAL_RECORDING=/path/to/recording.mov E2E_PORT=4193 npx playwright test -c scripts/real-check/speed
```

| Variable | Meaning |
|---|---|
| `REAL_RECORDING`, `REAL_SECONDS` | the video/audio file to time (required; there is no default path) and its duration (for the ratio) |
| `RC_MODE` | `fast` (default) or `precise` (high-precision piano mode) |
| `RC_RUNS` | conversions per browser (default 3: 1 cold + 2 warm) |
| `RC_WAV_SECONDS` | length of the synthetic WAV (a new length tests per-length GPU compiles) |
| `RC_NO_BUILD=1` | reuse the last build (`$TMPDIR/openroll-real-check-speed-dist`) |
| `RC_OUT_DIR` | serve another build (e.g. one made from an older commit, for before/after) |
| `RC_TAG` | label of the saved note lists (`$TMPDIR/openroll-real-check/notes-<tag>-*.json`) |
| `RC_PROGRESS=1` | print every progress update and stage span |

It builds into its own folder and port, so it can run next to other e2e runs.

Note: the very first conversion after Chrome has never compiled the model's GPU programs on the
machine (or after macOS evicted them from its Metal shader cache) takes ~10 s longer. Fresh
Playwright profiles do not reset that cache, so "cold" here means cold page + cold worker, with the
OS shader cache usually warm.

## Fast vs high precision — `scripts/real-check/compare/`

```bash
REAL_RECORDING=/path/to/recording.mov npm run real-check:compare   # port 4194
```

Both modes on the 20 renders of the recording-like **evaluation** set (`tests/fixtures/audio-realistic.ts`,
note F1 per render, per variant and mean) and, when `REAL_RECORDING` is set, on that file in a fresh
browser per mode (cold = model download/compile included, then warm), with the note count and the
right-hand C octaves (C onsets per octave and how many have the C an octave above within ±50 ms).
Also prints each mode's download size (raw and gzip). Results: `$TMPDIR/openroll-real-check/compare.json`.
Without `REAL_RECORDING` the recording part is skipped with a message.

## Real recording → sheet — `real-recording.spec.ts`

```bash
REAL_RECORDING=/path/to/recording.mov npm run real-check:sheet     # scripts/real-check/sheet.config.ts, port 4191
```

`REAL_MODE=fast|precise` picks the transcription mode (default: the app's default). Without
`REAL_RECORDING` the check is skipped with a message.
