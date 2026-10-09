# wt/wf-backend

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-10 01:13

## Muc tieu

Implement API contract section 13 / ADR-022 in the Rust backend without changing the shared contract.

## Da xong

- Added migration `0004_workflow.sql` and registered schema v4. Approved projects are backfilled with all five confirmed DNA rows; other projects have no rows and read as open.
- Added `workflow_get`, `workflow_confirm_step`, and `workflow_reopen_step` commands and camelCase DTOs.
- Added transactional confirm/reopen service behavior. Reopening a DNA step sets it open and later confirmed DNA steps to `needs_review`; archived projects use the existing archived error.
- Added generation gates in both `generations::validate` and transactional `insert_queued`; batch items therefore cannot queue before their purpose prerequisites are met.
- Added tests for migration backfill, ordered confirmation, reopen cascade, archived errors, and generation purposes. Updated existing backend test helpers so generation tests explicitly establish confirmed workflow state.
- Added and regenerated the three backend contract fixtures.

## Con no

- UI should call `workflow_get` for the five DNA states, `workflow_confirm_step` after the user confirms an unlocked DNA step, and `workflow_reopen_step` when reopening a confirmed/needs-review DNA step.
- Generation gate messages are English and include the step id, for example: `Finish the step 'Lighting' (dna.lighting) before generating.`, `Finish the step 'Master' (generate.master) before generating.`, and `Finish the step 'Anchors' (generate.anchors) before generating.`

## Lenh test

- `cargo test --lib` (232 tests passed, 5 ignored)
- `$env:UPDATE_BACKEND_FIXTURES='1'; cargo test contract_fixtures` (2 tests passed)
- `cargo fmt --all` (clean)
- `cargo clippy --all-targets -- -D warnings` (clean)
- `npx.cmd prettier --check .` (clean)
- `npm.cmd run verify` reached the Vitest backend-contract suite; the three new fixtures are expected to remain red until the parallel domain/UI agent adds the matching response schemas.

## Cam bay da gap

- Existing generation/batch/queue tests create fresh projects; the test-only `test_create_villa` helper now confirms all DNA steps explicitly. Production gates remain enforced in both validation paths.

