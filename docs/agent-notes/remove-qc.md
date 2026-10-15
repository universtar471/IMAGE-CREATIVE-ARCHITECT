# wt/remove-qc

## Goal

Remove the Vision QC / image scoring feature (ADR-024) completely, per ADR-033 and
`docs/agent-tasks/remove-qc.md`. User data is never deleted.

## Done

Frontend (`apps/desktop/src`, tests)

- Deleted `features/qc/**` (QcPanel, QcCanvas, QcBadge), `lib/qc.ts`, `tests/qc.test.ts`.
- Removed the `qc` workspace module (`modules.ts`; the `ScanSearch` icon import stays, the
  Region edit module uses it), its panel/canvas wiring, QC badges in `AssetThumbnail` and
  `ContactSheet`, the `qc` next-step module type and the "QC" wording in the post step.
- `lib/bridge.ts`: removed the four `qc_*` request/response entries.
- `lib/mockBackend.ts`: removed QC state and handlers; a `repair` submit is now rejected.
  Removed the `vision` capability flag from the mock providers.
- `i18n/vi.ts` / `en.ts`: removed the `qc` section, `modules.qc`, `projectStatus.qc`. The
  `purpose.repair` label stays ("Sửa theo QC" / "Repair") so old history displays.
- `styles/app.css`: removed every `.qc-*` rule.
- Tests: `units.test.ts` (module order/groups), `i18n.test.ts` (QC accent test removed),
  backend contract fixtures regenerated; `qc_*.json` fixtures deleted.

Domain (`packages/domain`)

- Deleted `src/qc/**`, `test-vectors/repair-prompt.json`, `test-vectors/vision-prompt.json`,
  `tests/phase6.test.ts`.
- Removed `ID_PREFIX.qc`, project status `qc` (never reachable) and its label, and the
  `vision` field of `ModelCapabilitiesSchema` (only QC used it; zod strips it from old data).
- `RepairParamsSchema` is now `{ qcReportId: string }` without the QC id regex, kept only so
  old repair rows parse. `GenerationSubmitRequestSchema` and `BatchCreateRequestSchema` reject
  purpose `repair`. `GenerationDTOSchema` still accepts old repair rows.
- New `tests/legacy-repair.test.ts`.

Backend (`apps/desktop/src-tauri/src`)

- Deleted `services/qc.rs` and `services/qc/local.rs`; removed the four `qc_*` commands and
  their invoke-list entries, the QC DTOs, `prefix::QC`, `ProjectStatus::Qc`.
- `services/queue.rs`: removed the auto-QC / auto-repair hooks; `queue::run` returns `()`.
- `services/generations.rs`: `validate` rejects purpose `repair` (batches go through the same
  function) and any `params.repair`; the QC report lookup is gone.
- `providers`: removed the `vision` / `vision_model` trait methods, OpenAI
  `vision_completion`, `VISION_TIMEOUT`, `Config::vision_model`, `HHTECH_VISION_MODEL`, and the
  `vision` capability flag. `GenerationParams::repair` is now `Option<serde_json::Value>`
  (legacy rows round-trip verbatim); the `RepairParams` struct is gone.
- `contract_fixtures.rs`: QC fixtures and the `QC_` id prefix removed.
- Kept unchanged: migration `0005_qc.sql`, its registration and its migration tests.
- New tests: `db::tests::database_with_legacy_qc_rows_still_opens` (QC report + settings + a
  repair generation inserted with raw SQL; core reopens, lists assets and history, QC rows
  still there) and `generations::tests::repair_generations_are_no_longer_accepted`.
- `docs/API_CONTRACTS.md` §15 marked as removed by ADR-033.

## Open

- `generations::run_job` keeps its generic `repair` lineage branch (`repairOf`/`repairDepth`):
  only a repair job already queued in an old database could reach it. Harmless, left as is.
- The `vision_completion` live `#[ignore]` test lived in `qc.rs` and is gone with it.
- Docs other than API_CONTRACTS §15 (ROADMAP Phase 6, ARCHITECTURE VisionProvider, ADR-024)
  still describe QC historically; ADR-033 supersedes them.

## Test commands

From the worktree root:

- `npm run verify` (typecheck, lint, vitest 50 files / 530 tests, cargo test 266 passed, 6 ignored)
- `npx prettier --check .`
- In `apps/desktop/src-tauri`: `cargo fmt --check`, `cargo clippy --offline --all-targets -- -D warnings`
- Contract fixtures: `UPDATE_BACKEND_FIXTURES=1 cargo test --offline contract_fixtures`
- `rg -i "\bqc\b|qc_|vision qc" apps/desktop/src apps/desktop/src-tauri/src packages/domain/src`
  finds only migration tests/registration in `db.rs`, the legacy-rows test, the `repair`
  label and comments saying QC was removed.

## Pitfalls

- The earlier partial edit removed the `ScanSearch` import from `modules.ts`, but Region edit
  still uses that icon; it was restored.
- Removing QC ids shifts the stable id counters, so almost every backend fixture changes
  (renumbering only); regenerate them rather than editing by hand.
- The fixture writer does not delete stale files; the `qc_*.json` fixtures were removed by hand.
