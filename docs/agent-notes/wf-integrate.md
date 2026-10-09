# wt/wf-integrate

## Goal

Integrate the Phase 4B workflow from the domain, Rust backend, and UI against API contract section 13.

## Changes

- Removed the UI workflow stand-in and all duplicate workflow rules. `apps/desktop/src/lib/workflow.ts`
  now only re-exports rules, types, and schemas from `@arch/domain`.
- The bridge uses the domain request and response schemas for all three workflow commands.
- Updated UI consumers to the domain shape (`moduleId`, `{ ok }`) and passed `cameraIds` so a
  project with cameras but no anchor views derives Render as available. Existing approved-master
  projects remain fully unlocked through the migration backfill and the UI derivation.
- Aligned backend and mock behavior: a `needs_review` step cannot be confirmed directly; it must
  be reopened first. Added domain, mock, and Rust tests for this contract rule.
- Updated contract fixture setup to reopen each cascaded step before confirming it again.
- Added `confirmAllDna` test helper and used it in generation/queue fixtures; fixtures that need
  `variation` also establish an approved master. Production gates remain enforced.
- Workflow request schemas accept all `WorkflowStepId` values; backend still returns
  `validation_error` for non-DNA command targets as required by section 13.3.

## Schema and fixtures

Ran `UPDATE_BACKEND_FIXTURES=1 cargo test contract_fixtures`; both fixture tests pass and the
checked-in fixture responses needed no content change after the workflow sequence fix. Retried
`npm run schema:export`, but Node/tsx still fails with `uv_os_get_passwd returned ENOMEM`; the
checked-in schema has no diff and the schema drift tests pass.

## Verification

- `cmd /c npm run verify`: pass; 28 Vitest files / 355 tests, Rust 235 passed / 5 ignored.
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check`: pass.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`: pass.
- `npx.cmd prettier --check .`: pass.

## Remaining

No required code work remains. JSON Schema export is still limited by the environment ENOMEM
failure noted above; no generated file drift was present.
