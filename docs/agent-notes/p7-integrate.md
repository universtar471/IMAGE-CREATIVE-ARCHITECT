# Phase 7 integration round 2

- Integrated the round-1 fixes across the domain, Rust backend, desktop bridge and region UI.
- Removed the remaining region-edit stand-in behavior: TS/Rust now share the same 2D feather algorithm, generation compositing fails when the source cannot be decoded, and the UI previews raster bytes and hit-tests the actual shape.
- Tightened rectangle, polygon and brush validation; archived projects are rejected by `region_list`; unlinking stores `objectId: null`; empty scene-object materials are omitted; Vietnamese region strings use diacritics.
- Regenerated `packages/domain/test-vectors/masks.json` and verified the Rust vectors match.

Verification commands:

- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd test -- --run`
- `cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `cargo clippy --all-targets --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `npx.cmd prettier --check .`

Pitfalls: the repository's `tsx` launcher hit `uv_os_get_passwd ENOMEM` in this environment, so the vector generator was run with Node's strip-types mode after temporarily adding `.ts` import specifiers, then those temporary import changes were reverted.
