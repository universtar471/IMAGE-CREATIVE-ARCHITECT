# wt/p6-backend

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-10 05:11

## Muc tieu

Implement Phase 6 backend QC contract in the desktop Rust backend without live paid calls.

## Da xong

- Added migration `0005_qc.sql` for `qc_reports` and `qc_settings`, including schema migration coverage.
- Added deterministic Sobel/IoU, Laplacian variance and clipping metrics with synthetic tests.
- Added QC DTOs, settings/report persistence, `qc_run`, `qc_list`, `qc_settings_get` and `qc_settings_set` commands.
- Added lenient/clamped vision reply parsing and score/result calculation.
- Added provider vision trait and OpenAI-compatible image-content chat request (JPEG q85, 1024px, 120s); HHTECH supports `HHTECH_VISION_MODEL` fallback to chat model.
- Added `repair` purpose/params validation, variation-style gating and repair lineage metadata.
- Added `vision` to model capabilities and regenerated backend fixtures.

## Con no

- Full Phase 6 automation (background auto-QC/auto-repair queue orchestration) is not wired yet.
- Repair prompt text is supplied by the request; no Rust mirror of the domain prompt builder is present in this worktree.

## Lenh test

- `cargo fmt --check`
- `cargo clippy --all-targets -- -D warnings`
- `cargo test --lib`
- `UPDATE_BACKEND_FIXTURES=1 cargo test contract_fixtures`

## Cam bay da gap

- Adding `vision` to `ModelCapabilities` requires updating every test provider/model initializer and fixture.
- `qc_run` releases the DB mutex before image decoding and provider vision calls, then inserts the immutable report afterward.

