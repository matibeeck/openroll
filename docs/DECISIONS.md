# Decisions log

| Date | Decision | Why | Alternatives considered |
|---|---|---|---|
| 2026-11-17 | 100% client-side web app (PWA), no backend | $0 hosting for any number of users, privacy, no accounts | Server-side inference (costs money per user) |
| 2026-11-17 | No LLM / ChatGPT in core features | Specialized models beat general LLMs here (GPT-5 reads piano scores poorly). "Sign in with ChatGPT" plan usage only works for Plus/Pro users, doesn't accept audio/video, and hosted web apps need OpenAI approval | Sign in with ChatGPT for optional extras later |
| 2026-11-17 | Canonical `Score` hub architecture | N + M converters instead of N × M | Direct format-to-format converters |
| 2026-11-17 | Basic Pitch (Apache-2.0) for audio → notes in the MVP | Runs in the browser, permissive license | Transkun ONNX (phase 2, more accurate on piano); MuScriptor (CC-BY-NC weights, forbidden) |
| 2026-11-17 | OMR (photo/PDF → notes) postponed to phase 2 | Hard problem; the strongest open model (LEGATO) depends on Llama 3.2 Vision, whose license excludes EU-domiciled developers | Audiveris (AGPL, Java, weaker on piano) |
| 2026-11-17 | Project license AGPL-3.0-only | Forks must stay open, while the author can still offer a paid hosted version later | MIT (maximum adoption, allows closed forks) |
| 2026-11-17 | Working name "OpenRoll" | Placeholder, rename freely. "NoteFall" is already taken by an iPad app (PDF → falling notes) | — |
| 2026-11-17 | TypeScript 6.0 (not 7) | typescript-eslint supports TS < 6.1 | TS 7 native compiler (no lint support yet) |
| 2026-11-17 | Own license audit script (`scripts/licenses.mjs`) reading package-lock.json | Zero extra deps, handles SPDX AND/OR, restricts LGPL to an explicit list (verovio) | license-checker (extra dep, slower) |
| 2026-11-17 | 0BSD added to the license allowlist | Public-domain-equivalent, strictly more permissive than MIT (used by tslib) | — |
| 2026-11-17 | Score/converter interfaces fixed before parallel work (`src/core/score.ts`, `src/converters/types.ts`) | Lets music-core and transcription work in parallel against one contract | — |
