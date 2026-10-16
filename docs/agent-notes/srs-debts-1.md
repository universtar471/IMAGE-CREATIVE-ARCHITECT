# wt/srs-debts-1

- Agent: claude
- Branched from: main (e9ac8df)
- Brief: `docs/agent-tasks/srs-debts-1.md`
- Nothing committed (as the brief asks).

## Goal

These are the five "NÊN SỬA" follow-ups from the srs-p0, srs-p2b and srs-p2d reviews:

1. Retry re-validates.
2. Exception panel everywhere.
3. `resolvedWarnings` holds accepted codes only.
4. Per-item detail target.
5. ShotIntent survives restart.

## Done

**1. Retry re-validates.**
- `store.retryJob(jobId, { approvedExceptions? })` now runs `revalidateRetry` first:
  - It loads the job and its generation.
  - It runs `checkShot` on the current persisted DNA, using the snapshot's camera and `prompt.shotIntent`.
- WARN codes accepted for the original submit stay accepted.
- If the verdict is not ALLOW, the retry is refused with `VALIDATION_ERROR` and `job_retry` is never called. The refusal is pushed to `retryConflicts`.
- `RetryConflictDialog` (mounted in `App.tsx`) shows the `ConflictPanel`. "Duyệt ngoại lệ" resends the WARN items with the new codes.
- Every retry path goes through `retryJob`:
  - jobs tray
  - ContactSheet failed item
  - enhance "retry failed"
  - history / GenerationResult
- Jobless (Phase 2) rows go through `submitGeneration(prompt)`, which was already gated. It now carries the snapshot's accepted codes.
- `job_retry` request: `{ jobId, validation? }`.
  - Rust `queue::retry_with` replaces the stored verdict and sets `resolved_warnings` from it, then calls `generations::validate`, which refuses BLOCK.
  - `queue::retry` is kept as a wrapper with `None`.
  - The mock backend does the same.

**2. Exception panel on the three surfaces.** A new hook, `features/validation/useBatchGate.ts`, holds a `gateBatch` preview plus the accepted codes. It is used by:
- ContactSheet anchor re-run: the first click shows the panel, nothing is sent while the gate is not ALLOW, and re-running after approval sends.
- Mood variations: panel in the dialog; submit is disabled until approval.
- Enhance batch: panel; submit is disabled until approval.

Each of them passes `approvedExceptions` to `createBatch`.

**3. `resolvedWarnings`.**
- The compiler emits `[]`. It no longer calls `validateShot`.
- `withValidation` sets exactly the accepted codes and replaces an older list. Found codes are in `validation.issueCodes`.
- Domain tests are updated. AC-21 byte-identity still passes. Versions are unchanged (`pc-1.8.0`, `cv-1.2.0`).

**4. Detail batches.**
- New domain function `buildDetailBatchItems(input, shots, anchors)`: one production item per shot, each compiled with its own ShotIntent (`targetDetailId`, camera, `detailShotCount`).
- `planBatch` takes `detailShots`.
- `BatchDialog` takes a `detailShots` prop and lists the items.
- `DetailPanel` passes the plan.
- `gateBatch` now validates each item with `item.prompt.shotIntent`. This also applies to normal camera batches with scene objects or effects; before, their intent was ignored.

**5. ShotIntent persistence.**
- `lib/shotIntentStorage.ts`: `localStorage["arch.shotIntent.<projectId>"]`, every access wrapped in try/catch, validated with `ShotIntentSchema`. An invalid value is removed.
- The store keeps its session `Map` as a cache over storage. `setShotIntent` writes to storage or clears it. The intent is never written into the DNA.

**Also:**
- Fixed the `Â·` mojibake in the mockBackend region-edit label. `EnhanceBatchDialog` was already clean.
- `docs/API_CONTRACTS.md`: `job_retry` row updated.
- `docs/DECISIONS.md`: ADR-034 amendment 3 and an ADR-036 amendment added.

## Still owed / limitations

- A retry cannot re-check the free text (extra prompt or region instruction) that was appended to the stored positive prompt, because it cannot be separated from the compiled text. Only DNA, camera and shot-intent rules are re-run.
- Rust cannot run `validateShot` itself. It trusts the verdict the desktop sends, and refuses only BLOCK, as it does for a new submit.
- `DetailPanel.generate` still sets the project ShotIntent to the first shot, which keeps the existing reselect hint and single Generate. This intent is now persisted.
- The ContactSheet re-run does not carry the source's accepted WARN codes over. A re-run is a new submit, so it asks again.
- In the detail-batch test, the request is sent with `purpose: "anchor"`, because the fixture has no approved anchors and the workflow blocks `production`.

## Test commands

```
export CARGO_TARGET_DIR=F:/cargo-targets/srs-debts-1
npm run verify
npx prettier --check .
cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy --offline --all-targets -- -D warnings && cargo test --offline
npx vitest run apps/desktop/tests/srsDebts1.test.tsx
```

## Pitfalls

- If vitest runs at the same time as a cargo build, its workers time out ("Failed to start forks worker"). Run them one after the other.
- In the mock queue, a job must stay queued long enough to be cancelled before it can be retried. The test uses `generationDelayMs: 400`.
- `SPACE_NOT_IN_BUILDING` is the easiest WARN/BLOCK that comes only from DNA, with no camera or text:
  - an unknown preset id gives WARN;
  - a villa-only preset in a townhouse gives BLOCK.
