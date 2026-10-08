# wt/p3-backend — P3-A backend: job queue, batches, camera anchors, status

- Agent: claude
- Branched from: `wt/p3-base` (097e424, Phase 3 contracts)
- Brief: `docs/agent-tasks/p3-backend.md`

## Goal

Every generation runs through a persistent job queue (ADR-017), with batches (ADR-018), camera
anchors and status derivation (ADR-016), the §10 commands, the events, and contract fixtures.
The UI (P3-C) and domain helpers (P3-B) are not on this branch.

## Done

- **Generations** (`services/generations.rs`)
  - `submit` = `validate` + `insert_queued` in one transaction, then it returns the `queued` DTO.
    Validation is unchanged from Phase 2 (still `AppError`, nothing enqueued). It also checks
    `cameraId` exists in the DNA (`VALIDATION_ERROR`, details `{ cameraId }`) and that a key is
    available (`PROVIDER_NOT_CONFIGURED`). No image bytes are read and the key is not kept.
  - `run_job(job_id)` is the Phase 2 path (provider call without the DB lock, full decode,
    files, one transaction for assets + versions + outputs). That transaction also completes
    the job, and it first re-checks the job is still `running`. Reference bytes and the key
    are read when the job starts.
- **Queue** (`services/queue.rs`)
  - The constants live here only: `LOCAL_SLOTS = 2`, `REMOTE_SLOTS = 1`, `MAX_ATTEMPTS = 3`,
    `RETRY_BACKOFF_SECS = [15, 60]`, `TERMINAL_HISTORY = 100`.
  - Slots are per provider id, sized by provider kind.
  - `claim(core, now)`: picks runnable jobs (highest priority, then oldest) while their provider
    has a free slot, and marks them `running` (attempt + 1).
  - `run(core, claim)`: runs one attempt, then records the result. A drop guard frees the slot,
    even on panic.
  - `tick(core, now)`: claim + run on the calling thread. Used by the deterministic tests.
  - The dispatcher thread is `start_worker` / `stop_worker`. One thread per running attempt.
    It is woken through a Condvar on enqueue, cancel, retry and slot release, and sleeps until
    the next `next_attempt_at` (capped at 30 s).
  - `Clock` and `Notifier` are injectable on `AppCore` (`clock`, `notifier`). `lib.rs` installs
    a `TauriNotifier` that emits `job://updated` / `generation://updated` (payload = DTO), then
    starts the worker.
  - `cancel`, `retry`, `list` and `get` back the commands.
  - Startup: `running` jobs and generations become `interrupted`. `queued` and `retrying` jobs
    stay and are picked up by the worker.
- **Batches** (`services/batches.rs`)
  - `create` validates every item with the same `validate` before inserting anything, then
    inserts the batch and all generations + jobs in one transaction, in item order.
  - `list` returns batches newest first, with counts for all seven statuses.
- **Anchors** (`services/anchors.rs`)
  - `list`, `set`, `clear`.
  - `dna_update` drops anchors of cameras that are gone.
  - `assets::remove` recomputes the status after the FK cascade.
- **Status** (`services/status.rs`)
  - `derive(p, dna_ready, AnchorProgress)`: master approved + ≥1 anchor view gives
    `anchor_generation`; every anchor view anchored gives `production`.
  - `save_with_status` computes the progress from the DNA and `camera_anchors`. Every path
    that changes an anchor, a DNA camera, the master or its approval goes through it.
- **Commands** registered in `lib.rs`: `batch_create`, `batch_list`, `job_list`, `job_cancel`,
  `job_retry`, `camera_anchor_list`, `camera_anchor_set`, `camera_anchor_clear`.
- **Codex review item** (`docs/agent-reviews/p2-backend.md` on main, last section): separate
  commit 7580ddd.
  - The env key fallback is an injectable `EnvSource` on `AppCore`. `open()` reads the process
    env; `open_with()` (tests, fixtures) starts empty.
  - The fixture's Gemini points at `http://127.0.0.1:9`.
  - New tests prove fixtures and descriptors are identical with a Gemini key in the
    environment. The `set_var` test now uses injection.
- **Fixtures** regenerated: 21 files, every §10 command, and jobs in `queued`, `retrying`,
  `cancelled`, `completed` and `failed`. `generation_submit_completed/_failed.json` are
  replaced by `generation_submit_queued.json` and `generation_get_failed.json`. The normalizer
  now also handles `JOB_` and `BAT_` IDs.

## Decisions (ambiguities resolved here)

1. **`generations.started_at` is still `NOT NULL`.** I did not rebuild the table.
   - A queued row stores its queue time there.
   - The DTO's `startedAt` is `null` while `queued`. For job-backed rows it is the latest
     attempt's start (`jobs.started_at`), so it is also `null` for a job cancelled before it
     started. Phase 2 rows keep their stored value.
   - Lists order by `created_at DESC`.
2. **A `retrying` job's generation is `queued`** (GenerationStatus has no `retrying`).
   - The generation's `error` is `null` while it waits; the job carries the last error.
   - `startedAt` is `null` again until the next attempt.
3. **The queue retries automatically only `rate_limited`, `network` and `timeout`** (ADR-017).
   - `bad_response` and `io` keep `retryable: true` as in Phase 2. That means "the user may press
     Retry"; they fail at once.
4. **Retries count started attempts.** Attempt 1 fails → wait 15 s; attempt 2 fails → wait
   60 s; attempt 3 fails → `failed`.
5. **Things that changed between enqueue and start fail the job without a provider call.**
   - non-retryable `invalid_request`: reference removed or file gone, project archived,
     provider or model no longer in the build
   - non-retryable `auth` (with the not-configured message): key removed
6. **`job_retry` copies the request and keeps label, priority, batch and camera.**
   - It is validated again like a new submit, so errors are `AppError`s.
   - The new job joins the old batch: batch `jobIds` lists item jobs first, then retries in
     creation order.
7. **Cancel sets the generation to `cancelled` with `finishedAt`.**
   - `durationMs` is `null` and there is no error.
   - A running job keeps its provider slot until the call returns.
   - A cancel that lands after the files were written but before the commit still discards
     them (checked inside the commit transaction).
8. **Anchors.**
   - Error codes:
     - unknown camera → `NOT_FOUND`
     - camera not an anchor view → `VALIDATION_ERROR`
     - unknown asset → `NOT_FOUND`
     - asset of another project → `VALIDATION_ERROR`
     - asset not ready or its file missing → `INVALID_STATE`
     - project archived → `INVALID_STATE`
   - `clear` on a camera without an anchor is fine.
   - When a camera stops being an anchor view, its anchor row is **kept**: ADR-016 only drops
     anchors of removed cameras. It is ignored by status derivation and comes back if the
     camera is flagged again.
9. **`batch_create` errors** prefix the message with `Item n ('label'): …` and add
   `details.itemIndex` (0-based). Other details are kept, e.g. `cameraId`.
   - Batch-level checks: name trimmed and not empty, 1–50 items, priority −10…10.
10. **Default job label** for a single submit is `<camera name or model label> — <purpose>`,
    e.g. "Front corner — anchor". Single submits have priority 0.
11. **Job timestamps come from the injected clock** (`AppCore::now_iso`). Asset and version
    rows still use `util::now_iso`.
12. **`job_list`** returns every non-terminal job plus the 100 most recently updated terminal
    ones, ordered `createdAt DESC`. A non-null unknown `projectId` returns `NOT_FOUND`.

## For the UI (P3-C)

- `generation_submit` returns at once with `status: "queued"`, `startedAt: null` and `jobId`
  set. Follow progress through events or `job_list`.
- **Events:** `job://updated` (payload `JobDTO`) and `generation://updated` (payload
  `GenerationDTO`) are emitted as a pair after each of these:
  - enqueue (each job of a batch too)
  - claim (`running`)
  - completed / failed / retrying
  - cancel
  - the new job of a retry
- **Sequence of one job:**
  - success: `queued → running → completed`
  - with retries: `… running → retrying → running …`
  - The generation mirrors it: `queued → running → queued → running → completed`.
- **Retry timing:**
  - `nextAttemptAt` = failure time + 15 s, then + 60 s.
  - The worker wakes itself when one is due, with no UI action.
  - `attempt` counts started attempts (0 while first queued). `maxAttempts` = 3.
- **Cancel:**
  - `job_cancel` on a terminal job → `INVALID_STATE`.
  - A running job shows `cancelled` at once, but its provider slot stays busy until the
    vendor call returns.
- **`job_retry`:**
  - Only for `failed` / `cancelled` / `interrupted`; otherwise `INVALID_STATE`.
  - It returns the **new** job. Validation errors (e.g. reference gone,
    `PROVIDER_NOT_CONFIGURED`) come back as `AppError`.
- **Interrupted jobs** are never re-sent automatically; the user retries them.
- Project status can now be `anchor_generation` / `production`. `dna_update`, anchor
  set/clear, master changes and asset removal can all change it. Re-read the project after
  these.

## Still open

- **UI and domain vitest are not run on this branch** (no `node_modules` in the worktree).
  Expected red until P3-C lands: `apps/desktop/tests/backendContract.test.ts` has no bridge
  schema for the new commands (`batch_create`, `batch_list`, `job_*`, `camera_anchor_*`), and
  the Phase 2 UI tests expect the old `GenerationDTO` (base contract change). Rust side: the
  key sets of `GenerationDTO`, `JobDTO`, `JobCounts` and `CameraAnchorDTO` are asserted
  against the Zod schemas in Rust tests.
- Not enforced in the backend: ADR-016's "production renders include the anchor right after
  the master". The UI builds references (ADR-008).
- If spawning a job thread fails (OS out of threads), that claim's slot is not released.
  The error is logged and it is very unlikely.

## Test commands

From `apps/desktop/src-tauri`:

```
cargo test                                   # 135 passed, 1 ignored (live Gemini smoke)
cargo clippy --all-targets -- -D warnings
cargo fmt --check
UPDATE_BACKEND_FIXTURES=1 cargo test contract_fixtures   # regenerate fixtures
```

Queue tests use `tests_support::queue_harness()`: a manual clock, an event recorder, and a
remote (`test_remote`, 1 slot) plus a local (`test_local`, 2 slots) double with scripted
behaviours. They call `queue::tick` / `claim` / `run` directly. Only
`worker_runs_local_and_remote_in_parallel_within_limits` starts the real dispatcher thread
(about 0.5 s).

## Pitfalls

- On Windows, Python's `open(..., 'w')` writes CRLF. Use `newline=''`.
- Long bash heredocs containing `'` sometimes fail in the agent shell; writing files instead
  works.
- Lock order is always: queue slots, then the DB. Never call `queue::emit` (it takes the DB
  lock) while holding a connection.
- `generations` tests shadow `submit` with `submit_and_run`, so the Phase 2 assertions still
  check a whole run.
