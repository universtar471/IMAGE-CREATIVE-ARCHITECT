# WF-B — Backend: workflow storage, commands, generation gating (ADR-022, API §13)

Branch `wt/wf-backend`. You own `apps/desktop/src-tauri/**` and `apps/desktop/tests/fixtures/backend/**`.

Read first:
- `tasks/PHASE_04B.md`, ADR-022, API §13
- existing migrations `0001`..`0003`, and `db.rs` for how migrations run
- `services/projects.rs` (archived checks, master approval)
- `services/generations.rs`, `services/batches.rs`, `services/anchors.rs`
- `commands.rs`, `lib.rs`, `dto.rs`, `contract_fixtures.rs`

## Scope

1. **Migration `migrations/0004_workflow.sql`**, exactly per §13.5.
   - Include the backfill for projects whose master is approved (`master_approved_at` not null).
   - Test the backfill on a DB created at migration 0003 with one approved and one unapproved project.
2. **`services/workflow.rs`**:
   - `get`, `confirm`, `reopen` per §13.3.
   - Use the unlock and cascade rules of §13.2 for dna steps.
   - Write each change in one transaction.
   - An archived project returns the existing archived error.
3. **Commands** `workflow_get`, `workflow_confirm_step`, `workflow_reopen_step`.
   - DTOs in camelCase, as in §13.1.
   - Register them in `lib.rs`.
4. **Generation gating (§13.4)** in `generation_submit` and `batch_create`, before any job is queued.
   - Facts:
     - master approved = project `master_approved_at` is set
     - anchor-view cameras = DNA `cameras[]` anchor-view flag (check the actual field name in the DNA schema)
     - approved anchors = rows in `camera_anchors`
   - Error: `validation_error` with a message naming the step, e.g. "Finish the step 'Ánh sáng' (dna.lighting) before generating." Keep messages English like other backend errors; the UI translates by step id.
   - Batches: check every item's purpose.
5. **Existing tests.** Projects in existing tests that generate must satisfy the gates. Add a test helper that confirms all dna steps and approves a master where needed. Do not weaken the gates.
6. **Contract fixtures.** Add the three commands, then regenerate with `UPDATE_BACKEND_FIXTURES=1 cargo test contract_fixtures`.

## Done when

- `npm run verify` is green.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `npx prettier --check .` are clean.
- `docs/agent-notes/wf-backend.md` is written: what the UI must call, and the gate messages.
