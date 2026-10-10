# wt/variation-master — variations always carry the master

## Goal

User report: "camera views and anchors look very different from the master".

What the user's studio.db shows for project VILLA TEST:
- There were no anchor or production runs.
- The two images were a **variation** (`gemini-3.1-flash-image`) sent with `referenceAssetIds: []`.
- So the model saw only text and drew a different villa.

The cause is in the Generate form. Once the user's reference selection is explicit, it is kept as is.
Nothing added the master back after the master was set, and the master could be unticked.

## Done

- `resolveGenerateForm` gives a variation `pinnedIds = [master]` when the master is ready and
  the model accepts image references.
  - The master is always image 1.
  - At the model cap, the last unpinned reference is dropped.
  - The master checkbox is disabled, with a hint explaining why.
- A variation on a model without image-to-image is disabled, with a reason.
- "Tạo lại" on an old variation that was sent without the master prepends the current master.
- Anchor and production batches already include the master (`features/camera/batch.ts`). No change there.

## Debt

- The backend does not enforce "variation must reference the master". Many Rust and TS tests use
  `variation` as a generic purpose with arbitrary references. Enforcing it means changing all those
  tests, so it is left for a later phase.

## Tests

- `npm run verify`: 428 Vitest tests pass; Rust tests are green.
- New cases are in `tests/generateFlow.test.ts` and `tests/masterApproval.test.tsx`.
