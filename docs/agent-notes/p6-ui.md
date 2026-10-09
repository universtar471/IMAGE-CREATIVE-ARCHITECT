# wt/p6-ui

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-10 05:11

## Muc tieu

Implement Phase 6 QC UI, bridge/mock commands, overlays, badges, repair and settings in the desktop app.

## Da xong

- Enabled the `qc` workspace module and added `QcPanel` with approved-master gating, local/vision runs, report rendering, history, repair action, batch progress and settings persistence.
- Added `apps/desktop/src/lib/qc.ts` UI stand-ins for the API 15 shapes and pure helpers (`scoreReport`, lenient vision parsing, repair prompt/payload, box mapping and latest-report lookup).
- Extended `bridge.ts` with `qc_run`, `qc_list`, `qc_settings_get`, `qc_settings_set`; mock backend persists deterministic reports/settings and uses no network calls.
- Added QC overlay controls in the canvas and lazy pass/warn/fail/unscored dots to tray/contact thumbnails.
- Added English/Vietnamese QC strings and contract tests.

## Con no

- Replace `src/lib/qc.ts` stand-ins with the exports from `@arch/domain` when p6-domain lands; remove casts around `purpose: "repair"` and `params.repair` once the domain generation schemas include them.
- Replace mock local metrics/vision reply with the backend implementation when p6-backend lands. The mock is intentionally deterministic and never calls paid providers.
- The overlay uses the shared image display rect after fit/zoom; further canvas changes should preserve that callback.

## Lenh test

- `npm.cmd run typecheck -w @arch/desktop`
- `npm.cmd test -- --run`
- `npx.cmd eslint apps/desktop/src apps/desktop/tests`
- `npx.cmd prettier --check apps/desktop/src apps/desktop/tests`

## Cam bay da gap

- Existing `units.test.ts` expected pre-Phase-6 modules; its implemented-module expectation now includes `qc`.
- The current branch predates p6-domain, so `src/lib/qc.ts` schemas/types and repair casts are intentionally temporary integration stand-ins.

