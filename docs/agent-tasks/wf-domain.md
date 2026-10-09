# WF-A — Domain: workflow model (ADR-022, API §13)

Branch `wt/wf-domain`. You own `packages/domain/**` only.

Read first:
- `tasks/PHASE_04B.md`
- ADR-022 and API §13
- `packages/domain/src/schemas/*` (for style)
- `packages/domain/src/index.ts` (exports)
- the existing tests

## Scope

1. **Schemas** in a new `packages/domain/src/workflow/`:
   - `WORKFLOW_STEPS`: an ordered readonly array of `{ id, stage, moduleId }`, exactly the §13.1 table.
   - `WorkflowStepIdSchema` (all 9 ids) and `DnaStepIdSchema` (the 5 dna ids).
   - `WorkflowStepStateSchema`: `{ stepId: DnaStepId, status: "open"|"confirmed"|"needs_review", confirmedAt: string|null }`.
   - `WorkflowDTOSchema`: `{ steps: WorkflowStepState[] }`.
   - Request schemas:
     - `workflow_get`: `{projectId}`
     - `workflow_confirm_step` and `workflow_reopen_step`: `{projectId, stepId}`
   - Export the types.
   - Run the JSON Schema export script and commit the regenerated file, like previous phases.

2. **`deriveWorkflow(persisted, facts)`**
   - Returns `{ steps: [{ id, stage, moduleId, status, blockedBy? }], stages: { dna, generate, post } }`.
   - Implements the §13.2 rules exactly.
   - `persisted` may be missing rows (= open).

3. **`confirmStep(persisted, stepId, now)` and `reopenStep(persisted, stepId)`**
   - Pure; return new arrays.
   - Throw `Error` with a clear English message on non-dna ids, locked steps, or reopening a step that is not confirmed / needs_review.

4. **`isGenerationAllowed(purpose, persisted, facts)`**
   - Returns `{ ok: true } | { ok: false, blockedBy: StepId }` per §13.4.
   - The backend mirrors it in Rust; the UI uses it to disable buttons.

5. **Tests**
   - every unlock rule
   - the chain on a new project
   - reopen cascading `needs_review`
   - zero cameras → anchors `skipped` and render `skipped`
   - ≥1 camera but none an anchor view → anchors `skipped`, render available
   - post unlocked only by an approved master
   - generation gating for all 4 purposes
   - the error cases

## Done when

- `npm run verify` is green. Do not edit `apps/**`.
- `docs/agent-notes/wf-domain.md` is written, listing the exported names and signatures so the UI and backend can integrate.
