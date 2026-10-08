# P3-A — Backend: job queue, batches, camera anchors, status

Branch `wt/p3-backend` (based on `wt/p3-base`). Read first:
- `tasks/PHASE_03.md`, ADR-014…018, `docs/API_CONTRACTS.md` §9–10
- `packages/domain/src/schemas/{generation,jobs,future}.ts`
- migration `0003_jobs.sql`
- the existing `services/generations.rs` and `contract_fixtures.rs`

You own `apps/desktop/src-tauri/**` and `apps/desktop/tests/fixtures/backend/**`.

## Scope

1. **DTOs and generations.** Update `GenerationDto` to the new shape and statuses. Then split `generations::submit` into two parts:
   - validate + enqueue: inserts a `queued` generation and its job, returns the DTO
   - `run_job(job)`: today's provider call, store and lineage path
   - Keep all Phase 2 validation and the transactional/failure guarantees.
   - `cameraId` must exist in the DNA `cameras`, otherwise `VALIDATION_ERROR`.

2. **Queue engine** (`services/queue.rs` or a `jobs/` module).
   - **Worker:** one dispatcher thread started in `lib.rs` setup and woken by a Condvar on enqueue, cancel or retry. It also wakes for timed retries.
   - **Pick order:** highest priority, then oldest runnable job. Runnable means `queued`, or `retrying` with `next_attempt_at <= now`.
   - **Concurrency:** per-provider slots, 2 for `local` and 1 for `remote`, defined as constants in one place. Each running job gets its own thread.
   - **No DB lock during the provider call** (unchanged rule).
   - **Retries:** for retryable kinds, wait 15 s then 60 s; `attempt` counts started attempts and stops at `max_attempts = 3`. Non-retryable errors fail at once.
   - **Cancel:**
     - queued or retrying → `cancelled` at once
     - running → `cancelled`; when the provider returns, discard the output, write no assets and remove any written files
     - the generation status mirrors the job
   - **Startup:** `running` → `interrupted`; `queued` and `retrying` resume.
   - **Events:** emit `job://updated` and `generation://updated` through an injectable notifier trait. The Tauri `AppHandle` implements it in the app; tests use a recorder.
   - **Tests must be deterministic.** Inject a clock and run single steps: expose `queue::tick(core, now)` or similar for tests, plus the real thread loop. Tests must not sleep for seconds.

3. **Batches.**
   - `batch_create` validates every item exactly like submit before inserting anything (one transaction), then enqueues one job per item, keeping item order.
   - `batch_list` returns per-status job counts.

4. **Commands.**
   - Jobs and anchors: `job_list` (the `projectId` may be null), `job_cancel`, `job_retry`, `camera_anchor_list`, `camera_anchor_set`, `camera_anchor_clear`.
   - `dna_update` drops anchors of removed cameras.
   - Validate an anchor set as follows:
     - the camera is an anchor view
     - the asset is ready
     - the asset belongs to the same project
   - Removing the asset cascades and removes its anchor.

5. **Status derivation** (`status.rs`, ADR-016):
   - master approved and at least 1 anchor view → `anchor_generation`
   - every anchor view anchored → `production`
   - Recompute the status whenever any of these change:
     - an anchor
     - a camera in the DNA
     - the master or its approval

6. **Contract fixtures.** Extend `contract_fixtures.rs` to cover every §10 command and a queued, completed, cancelled and retrying job. Regenerate the fixture files.

7. **Tests.**
   - The queue: priority order, per-provider concurrency limit, a local and a remote job running in parallel, retry with backoff then success, retry exhaustion, a non-retryable failure, cancel in each state, the running-cancel result discarded with no files left, restart recovery, events emitted.
   - Batch all-or-nothing validation.
   - Anchors: validation, cascade, DNA camera removal.
   - The status transitions.
   - The v2 → v3 database upgrade.

## Done when

- `cargo test`, `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check` all pass.
- The fixtures are regenerated.
- `docs/agent-notes/p3-backend.md` is written.
- You commit in small steps.

The UI and domain tests may stay red on your branch; list them in your note.
