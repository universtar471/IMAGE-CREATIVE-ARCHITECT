# Phase 3 — Anchor + Camera production

Goal (docs/ROADMAP.md): Camera DNA, camera presets by project type, Camera Director, anchor
views, batch generation, job queue with retries and controlled concurrency, Contact Sheet,
a functional Jobs tray.

Decisions: ADR-016…018. Contracts: `docs/API_CONTRACTS.md` §10.

The shared contract lives on branch `wt/p3-base`, not `main`, because it changes Phase 2 DTOs and
`main` must stay green. Every task branches from `wt/p3-base`. The base is red on purpose: the
Phase 2 UI/tests do not yet match the new `GenerationDTO`. Each task makes its own area green.
- `packages/domain/src/schemas/jobs.ts` — Job/Batch/CameraAnchor DTOs, event names
- `schemas/generation.ts` — new statuses/purposes, `cameraId`, `batchId`, `jobId`, `createdAt`
- `schemas/future.ts` — `CameraDNASchema` with `id`, `viewType`, `isAnchorView`, `distanceM`, `aspectRatio`
- `knowledge/pack.ts` — `CameraPresetSchema`, `cameraPresets`
- `packages/domain/schema/project-dna.schema.json` — re-exported
- `src-tauri/migrations/0003_jobs.sql` — `batches`, `jobs`, `camera_anchors`, `generations.camera_id/batch_id`

## Work split (parallel worktrees)

| Task | Branch | Owns | Brief |
|---|---|---|---|
| P3-A backend | `wt/p3-backend` | `apps/desktop/src-tauri/**`, `apps/desktop/tests/fixtures/backend/**` | `docs/agent-tasks/p3-backend.md` |
| P3-B domain | `wt/p3-domain` | `packages/domain/**` (except the contract files' shapes), `knowledge/**` | `docs/agent-tasks/p3-domain.md` |
| P3-C UI | `wt/p3-ui` | `apps/desktop/src/**`, `apps/desktop/tests/**` except `tests/fixtures/backend` | `docs/agent-tasks/p3-ui.md` |

Merge order: P3-B → P3-A → P3-C, then `npm run verify` on the merged result.

## Phase 3 acceptance

1. `npm run verify` is green after the merge. The contract fixtures cover every §10 command and parse with the UI schemas.
2. **Cameras:** the Camera module lists cameras. You can add one from the knowledge-pack presets or as a blank, edit it, delete it and mark it as an anchor view. The Camera Director top-down diagram shows the cameras around the building footprint. Edits autosave with the DNA.
3. **Anchors:** with a master approved, "Generate anchors" makes a batch with one item per anchor view. The Contact Sheet shows the results and "Approve as anchor" sets each camera's anchor. Status moves `master_approved` → `anchor_generation` → `production`.
4. **Production batch:** a production batch over chosen cameras includes, for each camera, the master and that camera's anchor as references.
5. **Jobs tray:**
   - live status, attempt counter, cancel, retry
   - a running remote job blocks other remote jobs of the same provider, while local jobs run 2 at a time
   - a retryable failure retries with backoff
   - after a restart, queued jobs resume and running jobs show `interrupted`
6. The Phase 2 Generate module keeps working: a single submit now goes through the queue.

Do not start Phase 4.
