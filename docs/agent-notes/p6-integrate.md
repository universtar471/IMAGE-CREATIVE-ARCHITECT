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

## Round 1 fixes

- `passMin` and `categoryMin` now accept finite fractional numbers from 0 to 100 in the domain schema, mock validation, UI inputs, and Rust DTO/settings validation. Local-only scoring uses `edgeAlignment`, returns `fail` below `passMin`, `warn` only in the following 10-point band, and `unscored` when no overall score exists.
- TypeScript and Rust vision parsers scan balanced JSON candidates until the first candidate that validates, normalize fractional scores by round-and-clamp, and clamp artifact boxes. Shared `vision-prompt.json` coverage verifies identical prompt text, including stable project DNA serialization; the Rust vision request now uses that DNA-aware prompt builder.
- Vision provider/model controls in both run and settings UI list only models with `vision: true`; settings persist `visionProviderId` and `visionModel`, with the cost warning beside automatic QC.
- QC panel, canvas, batch progress, and badges ignore late responses after project/asset changes; report rendering is scoped to the active project/asset. Added parser, prompt, i18n, and scoring regression coverage, plus a Vietnamese QC diacritic guard.
- Rewrote the QC Vietnamese namespace with natural diacritics and removed the unaccented/English `deterministic` wording. Existing round-1 parser/scoring/repair fixes were verified in this integrated worktree and retained.
