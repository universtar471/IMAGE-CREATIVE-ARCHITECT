# wt/p6-integrate

- Agent: codex
- Branch: `wt/p6-integrate`
- Scope: integrate Phase 6 domain, backend and UI

## Da xong

- UI QC helpers now re-export the canonical `@arch/domain` schemas and pure functions; bridge parses QC responses with domain schemas and all `TODO(p6-domain)` markers in source code are gone.
- Added deterministic repair prompt parity using `packages/domain/test-vectors/repair-prompt.json`; TypeScript and Rust tests compare the same snapshot. DNA facts use stable key ordering so the generated prompt is identical across runtimes.
- Added post-commit automation: successful non-repair generations schedule QC in a detached worker in production, serialize work per project, run local-only unless a vision provider is configured, and enqueue at most one gated repair per output while recording `repairOf`/`repairDepth`.
- Corrected local score result rules (`< passMin` is `fail`, then warn band), lenient Rust vision parsing (balanced-object search, score rounding/clamping, box clamping and required fields), mock/provider vision capabilities, and repair-purpose payload wiring.
- Regenerated backend QC fixtures with `UPDATE_BACKEND_FIXTURES=1`.

## Con no

- `npm run schema:export` was retried and remains blocked by the environment's `uv_os_get_passwd returned ENOMEM` error from `tsx`; no schema output was changed.
- The task instruction says not to edit `docs/agent-tasks`; that file still contains the historical `TODO(p6-domain)` wording, while source code has none.

## Lenh test

- `npm.cmd run verify` (417 TS tests, 252 Rust tests, 6 ignored live tests)
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check`
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`
- `npx.cmd prettier --check .`
- `UPDATE_BACKEND_FIXTURES=1 cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml contract_fixtures`

## Cam bay da gap

- The shared prompt fixture must keep object keys in the canonical sorted form because Rust's default `serde_json::Map` serializes keys in sorted order; the domain prompt builder now applies the same stable serialization.
