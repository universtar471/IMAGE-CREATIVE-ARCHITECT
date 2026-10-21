# Free generation and visible model selection

2026-10-21. User request: remove workflow step locks and show image model selection.

- All DNA sections are accessible in any order. Confirmed/review progress no longer makes
  their controls read-only. Reopening does not lock later sections or image generation.
- Hero, anchor, production and image edit submissions have no workflow approval prerequisites.
  Keep input validation, provider capabilities, keys, archive protections and cost confirmation.
  Camera batch tools still require actual camera/source data to build their requests.
- Simple and Advanced both show provider and model selectors at the top. A provider without
  a key can be selected; Generate explains the missing key and settings targets that provider.
- No database migration, automatic approval, or deletion of existing progress is needed.

Verification: typecheck, lint, Prettier, production build, Vitest and Chromium regression QA.
Rust: 364 pass, 6 live-provider cases ignored; Clippy passes with warnings denied.
New regressions failed before fixes: independent DNA access and creation without approval,
Simple model selection. A native Rust test generates an offline preview without confirmed DNA
or approved Master and exercises validation plus queue insertion. Browser checks preserve
fullscreen, responsive layouts, portrait thumbnails and video pause behavior.

Screenshot: models.png. Browser measurements: measurements.json. Browser QA uses an isolated
mock database. No paid AI provider calls were made; native display scaling is not simulated.

Vitest final result: 103 files, 1,152 tests passed.
