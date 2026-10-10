# wt/p7-backend

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-10 06:33

## Muc tieu
Implement Phase 7 backend region storage, mask processing, provider capability and region-edit generation.

## Da xong

- Added migration `0006_regions.sql` with project/asset cascade and region commands/DTOs.
- Added region shape validation, mask rasterisation, three-pass box feathering, PNG mask output and local composite.
- Added `region_edit` purpose, workflow gate, region ownership validation, native mask upload and non-native second-image path.
- Added `supportsMask` to provider capabilities and regenerated backend provider fixtures.

## Con no

## Lenh test

- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` (260 passed, 6 ignored)
- `UPDATE_BACKEND_FIXTURES=1 cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib contract_fixtures::backend_fixtures_are_current`

## Cam bay da gap

- Shared domain mask vectors were not present in this worktree; local deterministic mask tests cover the implementation until the domain file lands.
- No live provider tests were run.

