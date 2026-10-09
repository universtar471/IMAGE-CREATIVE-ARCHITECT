# wt/wf-ui

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-10 01:13

## Muc tieu
Implement Phase 4B guided workflow UI against API section 13 in the `apps/desktop/src` and
`apps/desktop/tests` scope.

## Da xong
- Added `src/lib/workflow.ts` stand-in with the exact §13 step ids, statuses, derive, confirm,
  reopen cascade and generation gating rules.
- Added bridge request/response shapes and persisted mock-backend workflow commands.
- Store loads workflow on project open, derives status from master/camera/anchor facts, and
  refreshes after confirm/reopen, master approval, camera changes and anchor changes.
- Added guided navigation status icons, reusable `StepFrame` read-only/locked/review UI, the
  Generate stepper/gating, Overview workflow rows, field hints, and the Ghim/Pin prompt-lock
  wording.
- Added workflow unit and mock command tests; updated navigation order test for Generate before
  Post-production per ADR-022.

## Con no
- The parallel domain agent's `@arch/domain` workflow module should replace the local stand-in
  and duplicate bridge schemas/types during integration.
- The parallel Rust/backend agent must provide the same workflow commands and generation gating;
  the browser mock is implemented here for preview/tests.
- Existing pre-Phase-4B generation/queue tests submit on a brand-new project without confirming
  DNA, so they now fail with the required `VALIDATION_ERROR` until their fixtures are migrated.

## Lenh test
- `npm.cmd run typecheck --workspace @arch/desktop` (pass)
- `npm.cmd test -- --run apps/desktop/tests/workflow.test.ts apps/desktop/tests/workflowBackend.test.ts apps/desktop/tests/i18n.test.ts apps/desktop/tests/units.test.ts apps/desktop/tests/i18nSwitch.test.tsx apps/desktop/tests/p4-ui.test.ts` (65 pass)
- `npm.cmd run build --workspace @arch/desktop` (pass; Vite production bundle)
- `npx.cmd prettier --check apps/desktop/src apps/desktop/tests` (pass)
- `npm.cmd test -- --run apps/desktop/tests` (36 legacy generation/queue failures; see Con no)

## Cam bay da gap
- Workflow state is persisted only for the five DNA ids; derived generate/post rows are never
  sent to `workflow_*` commands.
- `fieldset[disabled]` is the UI read-only guard, while archived projects still use the existing
  archive guard in individual fields.
- The mock uses `VALIDATION_ERROR` (the existing desktop AppError code spelling) and includes the
  blocking step id in the message.
