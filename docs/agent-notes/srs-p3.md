# SRS P3 handoff

## Done

- Added optional `preservationMode`, lock flags and upscale target contracts while preserving legacy enhancement params.
- Added deterministic `resolveUpscaleSize` domain helper for long-edge, UHD contain and custom contain targets, including no-downscale actions.
- Added SRS preservation prompt template and strict-mode local provider validation.
- Extended the local Lanczos3 provider with target-aware contain/letterbox output, no-downscale handling and alpha preservation.
- Added optional `enhanceCheck` DTO field and documented the API extension.
- Updated Enhance panel and batch dialog with strict/balanced/creative selectors, lock controls and corrected batch separator; added bilingual labels.

## Shapes chosen

- `upscale.target` uses `long_edge_2048`, `long_edge_4096`, `uhd_3840x2160_contain`, or `{ width, height, fit: "contain" }`.
- `ifAlreadyLarger` is `keep | quality_only | skip`.
- Rust keeps old `mode` for wire compatibility and maps strict to `conservative`/`local_upscale`.

## Debts / limitations

- Local check calculation and persistence are represented by the optional DTO contract but are not yet wired into the queue completion transaction.
- The generated JSON schema export was attempted but failed in this environment with Node `uv_os_get_passwd` ENOMEM; no generated artifact was changed.
- Batch retry/status UI remains the existing queue implementation; no new backend retry API was introduced.

## Traps

- PowerShell blocks `npx.ps1`; use `cmd /c npx ...` for verification commands.
- Cargo commands must stay offline.
- Existing Vietnamese dictionaries contain historical mojibake outside the touched keys; new P3 labels use full Unicode diacritics.

## Tests

- `cmd /c npx vitest run packages/domain/tests/phase5.test.ts` — 13 passed.
- `cmd /c npm run typecheck --workspaces --if-present` — passed.
- `cmd /c npm run lint` — passed.
- `cmd /c cargo fmt --check` — passed.
- `cmd /c cargo test --offline --lib` — 291 passed, 1 failed before the DTO serialization fix; targeted rerun passed.
