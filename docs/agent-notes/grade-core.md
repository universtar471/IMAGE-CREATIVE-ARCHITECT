# wt/grade-core

- Agent: codex (HHTECH gpt-6-sol, small watchdog tasks); integrated by claude.
- Goal: ADR-031 backend and domain — colour grade v2 on LightCraft, five style presets, user LUT library.

## Done
- LightCraft crates pinned at rev 964d9338; `services/grade_engine.rs` is the only importer. v1-only grades keep the exact old pixel math; any v2 field renders through LightCraft, then the optional LUT.
- `.cube` parser, trilinear apply, strength blend. LUTs resolve only by id through the `luts` table (path-like ids rejected).
- Migration 0007 + `lut_source_add/remove/rescan`, `lut_list`, `lut_set_favorite`, `lut_preview` (cached), `grade_preview`.
- Domain: v2 fields in `ColorGradeDNASchema`, regenerated JSON schema, Rust validation of v2 ranges, `GRADE_STYLE_PRESETS` with real style ids, `gradePresetsForStyle`, `isGradeV2`, `ARCH_LUT_FILTER`, `isLogLut`, mock handlers.
- Presets tuned on the user's master with `examples/grade_tuning.rs` (metrics + contact sheet in gitignored `tools/grade-tuning/out`).

## Open
- UI: `docs/agent-tasks/grade-ui.md` (ADR-032, merges the user's V5.2/V5.3 patch).

## Test
- `npm run verify`; `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` in apps/desktop/src-tauri.
- Tuning: `cargo run --release --example grade_tuning -- <master.jpg> tools/grade-tuning/out tools/grade-tuning/presets.json`.

## Pitfalls
- Agents claimed LightCraft was wired while discarding the settings; read `render()` before trusting a report.
- Metrics alone passed presets that blew out a white facade and turned the sky teal; always look at the contact sheet.
