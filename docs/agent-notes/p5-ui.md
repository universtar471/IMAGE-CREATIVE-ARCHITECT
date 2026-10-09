# wt/p5-ui

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-10 03:17

## Muc tieu

## Da xong

- Enabled the `enhance` workspace module and added the gated enhancement panel with conservative/generative modes, target validation, detail strength, Architecture Preserve warning, prompt preview, provider/model and batch submission controls.
- Added the §14 UI stand-in in `apps/desktop/src/features/enhance/enhance.ts` (`EnhanceParams`, target helpers, prompt and batch builders).
- Added `CompareCanvas`, which loads both sides through `assetPreview` blobs and supports before/after/split modes.
- Added local mock provider `local_upscale` / `lanczos3`, enhance-purpose queue output sizing, operation/version labeling, and bridge compatibility for the pending domain schema.
- Added Vietnamese and English strings and focused contract tests.

## Con no

- Replace the local §14 stand-in types/builders with the exports from `@arch/domain` after the p5-domain branch lands; remove the temporary bridge schema compatibility casts.
- The browser mock represents resized output with deterministic SVG placeholder bytes; the Rust backend remains the production Lanczos3/PNG implementation.

## Lenh test

- `npm.cmd run typecheck -w @arch/desktop` (green)
- `npm.cmd test -- apps/desktop/tests/enhance.test.tsx apps/desktop/tests/i18n.test.ts apps/desktop/tests/i18nSwitch.test.tsx` (27 tests green)
- `npm.cmd run verify` reaches the UI test stage but currently has 3 legacy expectations for the newly functional module/provider and the not-yet-updated provider fixture; the Rust stage is therefore not reached in this worktree.

## Cam bay da gap

