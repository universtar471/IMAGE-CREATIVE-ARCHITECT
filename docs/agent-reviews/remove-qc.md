# Review: remove the Vision QC scoring feature (ADR-033)

Branch: `wt/remove-qc`.
Verdict: **ĐẠT** (pass).

## Verification (run by the lead, after merging main)

- `npm run verify` passes:
  - typecheck and lint
  - 539 JS tests
  - the Rust suite
- `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` are clean.
- `npx prettier --check .` is clean.
- `rg -i "\bqc\b|qc_"` over the app sources finds only:
  - the kept migration 0005 registration and its tests
  - the legacy-database test
  - the repair label
  - removal comments

## Checked

**Removed**
- the QC module and panel
- the badges on thumbnails, the contact sheet and the property panel
- the next-step guidance and settings
- auto QC and auto repair
- the `qc_*` commands and `services/qc.rs`
- the vision provider path, including `HHTECH_VISION_MODEL`
- the QC fixtures and tests

**Data safety**
- The QC tables and migration 0005 are unchanged, and no drop migration was added.
- `db::tests::database_with_legacy_qc_rows_still_opens` inserts reports, settings and a repair generation with raw SQL, then reopens the core and lists the assets and history.

**Repair**
- `repair` is used only by QC flows: the workflow gating, the mock and the job schemas. Its label stays for old history.
- New repair submissions are rejected in the domain, the mock and Rust.

## NÊN SỬA (should fix, not blocking)

1. `generations::run_job` keeps a lineage branch for `repair`. It is reachable only by a repair job already queued in an old database. That is harmless, but the branch can be removed later.
2. ROADMAP, ARCHITECTURE and ADR-024 still describe QC as history. ADR-033 supersedes them; update the roadmap wording when it is next edited.
