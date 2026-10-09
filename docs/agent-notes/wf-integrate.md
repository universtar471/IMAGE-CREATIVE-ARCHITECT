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

## Round 1 fixes

- Backend confirm `needs_review`: the integrated Rust and mock paths already rejected direct confirmation like the domain helper; verified the rule with tests that re-confirm the reopened predecessor first, then added the unambiguous §13.2 clarification.
- Camera Director read-only: drag and keyboard nudges now also require `dna.camera` to be `available`; regression covered by `workflowRound1.test.tsx`.
- Anchor and production actions: removed them from DNA > Camera and placed them in Create images with purpose-specific `isGenerationAllowed` gates; UI test verifies the ownership move.
- Workflow facts: the integrated store already passed `cameraIds` on open and refresh; added a store regression for a non-anchor camera (Render available), then empty/non-empty refreshes (skipped/available).
- Reopen impact: the dialog now computes later confirmed DNA steps before the backend call, so it lists the steps that will become `needs_review`; covered by the exported helper test.
- Overview hub: replaced generic summaries with DNA-backed building, context, references, camera, lighting/weather, generation and grade summaries; added expandable quick-edit fields for each DNA step, disabled unless the step is available. Covered by the Overview UI regression.
- Vietnamese workflow wording: rewrote the affected `vi.ts` values and camera/lighting hints as UTF-8 Vietnamese; added a dictionary test rejecting common mojibake sequences.
- Navigation: split explicit Overview, DNA, Generate, Post and Export groups, added visible DNA/Post headers, and used a minus icon for skipped statuses (including the Generate stepper).

Tests: `npm run verify`, `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check`,
`cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`, and
`npx prettier --check .` all pass.
