# wt/master-wins — the master image beats conflicting DNA text

## Goal

User report: the front-left anchor did not follow the master.

The run did send the master as image 1. But the DNA text said "2 floors" with no stone,
and the master is a single-storey house with stone cladding. The prompt carried two
conflicting hard rules:
- the reference instruction: "match the master exactly"
- the preservation instruction: "Keep exactly 2 floors"

Gemini 3.1 Flash followed the text.

## Done

- **Compiler `pc-1.2.1`.** When a master is referenced:
  - The preservation lines say "Keep the floor count shown in Image N (master)" and
    "Keep the facade materials visible in Image N (master)", instead of the DNA floor count
    and "Do not substitute the specified materials".
  - The master reference instruction now ends with "Where the text description differs from
    this image, follow this image."
  - Without a master, nothing changes.
- **`MasterDnaCheck`.** A note under "Approve master" in Overview, and in the latest result
  when the master is pending or not set yet.
  - It shows the DNA floors and materials.
  - It links to the Building DNA module, so the user can make the text match the image.
- **Cancel a job that already ended.** The tray, generations and batches are refreshed, and an
  info toast is shown instead of the raw "already ended" error. The UI had missed the job's
  events after a dev HMR reload.

## Tests

- `npm run verify`: 431 Vitest tests pass; Rust tests are green.
- `npx prettier --check .` is clean.
- New cases:
  - compiler master-priority (in the domain tests)
  - `queue.test.ts` cancel-after-end
  - `masterDnaCheck.test.tsx`

## Pitfall

Domain tests that read `test-vectors` must run from the repo root (`npm test`). Run from
`packages/domain`, the path resolves to `packages/domain/packages/domain` and fails.
