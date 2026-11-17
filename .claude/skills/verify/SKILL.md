---
name: verify
description: Fast pre-commit check for this repo (typecheck, lint, unit and round-trip tests, license audit). Run before every commit and whenever you need to know if the build is green.
---

1. From the repo root, run `npm run check`. Before M0 creates that script, run whatever subset exists and say so.
2. If it fails, fix the cause, not the test. Never lower thresholds, skip tests or widen the license allowlist to get green. If the fix is out of scope, record it in REPORTE.md under "Qué no funciona" and say so.
3. If the change touches a UI flow, also run `npm run test:e2e` for the affected spec.
4. Report in two lines: the commands you ran and their pass/fail counts.
