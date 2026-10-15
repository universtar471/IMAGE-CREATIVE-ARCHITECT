# Remove the Vision QC / scoring feature (ADR-033)

**Branch:** `wt/remove-qc`.

**Goal:** the user does not need image scoring. Remove the Vision QC feature (ADR-024) from the app completely, so it no longer appears in the UI and no QC code runs. Never delete user data.

## Remove

**UI**
- the QC workspace module (`features/workspace/modules.ts` entry `qc` and its panel `features/qc/**`)
- QC badges on thumbnails, the contact sheet and the property panel
- the QC next-step guidance (`lib/nextStep.ts`)
- "Sửa theo QC" (repair from a QC report)
- QC settings, including auto QC
- `lib/qc.ts` and the QC bridge calls
- the QC mock handlers
- the `qc` i18n sections in vi and en
- the QC CSS
- QC tests

**Backend**
- the `qc_*` Tauri commands and their invoke-list entries
- `services/qc.rs`
- auto-QC and auto-repair hooks in the generation and queue services
- vision provider calls used only by QC
- QC DTOs and contract fixtures

Remove domain QC schemas and labels only where nothing else uses them.

## Keep

- **Database:** keep the existing QC tables and migrations exactly as they are.
  - Do not add a migration that drops them, and do not delete rows.
  - Migrations must still apply on old databases.
  - Old databases with QC rows must still open.
- **Generation history:** keep the generation purpose `repair` and its label, so old history still displays. New code must not create QC repairs.
- **Other features:** region edit, enhance, anchors, batches, grade and assist work as before.

## Done when

- `rg -i "\bqc\b|vision qc|qc_"` over `apps/desktop/src`, `apps/desktop/src-tauri/src` and `packages/domain/src` finds only:
  - the kept migration SQL
  - the `repair` purpose label
  - comments stating that QC was removed
- `npm run verify` is green.
- `npx prettier --check .` is clean.
- `cargo fmt --check` is clean.
- `cargo clippy --all-targets -- -D warnings` is clean (manifest `apps/desktop/src-tauri/Cargo.toml`).
- A Rust test opens a database that contains QC rows and the app still starts.
- `docs/agent-notes/remove-qc.md` is written. Do not commit.
