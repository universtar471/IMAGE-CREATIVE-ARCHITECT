# wt/interior-integrate

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-10 20:43

## Muc tieu

Hoan tat hop nhat `wt/interior-domain` va `wt/interior-ui`: UI dung catalog/schema/helper that tu `@arch/domain`, DNA noi that duoc kiem tra dong nhat voi Zod va Rust, va compiler `pc-1.4.0` duoc kiem tra end-to-end.

## Da xong

- Rut gon `apps/desktop/src/lib/interior.ts` thanh lop re-export tu `@arch/domain` va `catalogLabel`; da xoa toan bo stand-in catalog/helper/schema trong UI.
- UI dung `InteriorDNASchema`/`InteriorDNA`, `INTERIOR_CATALOG`, `roomsForUse`, `furnitureForRoom`, `styleDefaults`, `applyStyleDefaults`, `presetSurfaces`, `defaultInteriorDNA` va `proposeInteriorFromLegacy` tu domain.
- Camera quick-add dung `CAMERA_PRESETS` tu domain; UI chi bo sung metadata hien thi lens/view type.
- Mock backend luu bang `ProjectDNASchema.parse` sau `validateProjectDNA`, khong con preserve bridge cho `interior`; test backend tu choi room sai use va surface id sai.
- Them E2E UI test: wizard tao project noi that, DNA parse duoc bang schema domain, prompt co cac dong `Interior space`, `Interior style`, `Materials and colors`, `Furnishing`.

## Con no

Khong con viec trong pham vi task.

## Lenh test

- `npm.cmd run verify` - PASS: 41 Vitest files, 490 tests; Rust 267 passed, 6 live-provider tests ignored.
- `npm.cmd run typecheck` - PASS.
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check` - PASS.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings` - PASS.
- `npx.cmd prettier --check .` - PASS.

## Cam bay da gap

- Khong goi paid/live API.
- PowerShell chay npm qua `npm.cmd` va npx qua `npx.cmd`.
- `docs/agent-tasks/*` khong bi sua.

