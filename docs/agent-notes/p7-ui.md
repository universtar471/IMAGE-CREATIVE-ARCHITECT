# wt/p7-ui

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-10 06:33

## Muc tieu

## Da xong

- Added the `regions` post module, guided approved-master gating, canvas rectangle/polygon/brush tools, select/delete, mask preview and disabled auto-select.
- Added region list editing, scene objects with DNA autosave and pinned-object locks, provider/model edit panel, native/secondary mask badge, prompt preview, region generation submit and CompareCanvas result.
- Added bridge/mock commands `region_list`, `region_save`, `region_delete`, `region_edit` compatibility and mock provider mask capability metadata.
- Added `apps/desktop/src/lib/regions.ts` stand-ins marked `TODO(p7-domain)` for IDs, shapes, rasterisation, feathering, prompt compilation, scene lines and stale guards.
- Added focused contract tests in `apps/desktop/tests/regions.test.ts`; updated workspace module expectations.

## Con no

- The Rust/domain implementation and canonical `packages/domain/test-vectors/masks.json` are supplied by P7-A/P7-B; the UI stand-ins should be removed or replaced when those land.

## Lenh test

- `npm.cmd run typecheck -w @arch/desktop`
- `npm.cmd exec vitest -- run --project desktop`
- `npm.cmd exec prettier -- --check <changed desktop files>`
- `npm.cmd run verify` (427 JS tests, 255 Rust tests; 6 ignored live-provider tests)

## Cam bay da gap

