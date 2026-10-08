# P3-C — UI: Camera module, Camera Director, anchors, batches, Contact Sheet, Jobs tray

Branch `wt/p3-ui`, based on `wt/p3-base`.

Read first:
- `tasks/PHASE_03.md`
- ADR-008 and ADR-014…018
- `docs/API_CONTRACTS.md` §10
- `docs/UI_UX_SPEC.md`
- the contract schemas
- the existing Generate / History / Versions code

You own `apps/desktop/src/**` and `apps/desktop/tests/**`, except `tests/fixtures/backend`.

The domain helpers (camera ids, presets, camera prompt section, batch builders) are built in parallel by P3-B on `wt/p3-domain`.
- If you need one before it lands, write a minimal local version in `apps/desktop/src/lib/` behind the same signature as in `docs/agent-tasks/p3-domain.md`.
- Mark it `TODO(p3-domain)`. It will be swapped out at merge.

## Scope

1. **Bridge and mock backend**
   - Add the new commands and shapes, and the changed `GenerationDTO`.
   - Add an event subscription API: `subscribe(event, handler)`, which uses Tauri `listen` in the app and an in-process emitter in the mock.
   - The mock implements the queue faithfully enough to test:
     - async jobs with delays
     - per-provider concurrency (local 2, remote 1)
     - retry with backoff (scaled down in the mock)
     - cancel
     - `[fail]` and `[flaky]` prompt markers, where flaky fails once with `rate_limited` and then succeeds
     - the events

2. **Generate module.** Submit now returns a `queued` generation.
   - Progress comes from events or `job_list`.
   - Keep everything that already works: the result lands after navigation, a project switch is safe, and Retry works.

3. **Camera module.** In `modules.ts` set `availableIn: null`.
   - **Camera list** in the right panel: add from preset (the pack's presets), add blank, duplicate, delete with confirm, rename, and toggle anchor view.
   - **Field editor:** view type, azimuth, elevation, height, distance, lens, aspect ratio, composition, notes.
   - **Autosave** through the existing DNA autosave.
   - **Canvas: Camera Director.**
     - An SVG top-down plan with the building footprint as a rectangle, sized from the DNA dimensions or a default.
     - The front-facade side is labelled.
     - Each camera is drawn as an icon with its view cone, placed from azimuth and distance. Elevation is shown as a badge.
     - Drag a camera to change its azimuth and distance; the keyboard can nudge it too.
     - Click selects a camera; the selection is synced with the list.
     - Anchor views and anchored cameras look visibly different.
   - The camera's prompt preview section, compiled from persisted data.

4. **Anchors workflow.**
   - **"Generate anchors":** enabled when the master is approved and at least one anchor view exists. It opens a batch dialog (provider, model, params, outputs per camera) and builds items with the anchor batch builder.
   - **Contact Sheet:** a canvas view showing a batch's outputs grouped per camera, with large thumbnails and live job status.
   - **Contact Sheet actions:**
     - "Approve as anchor" → `camera_anchor_set`
     - compare with the master side by side
     - open in the canvas
   - **Status badge:** reflects `anchor_generation` / `production`.

5. **Production batch.** The "Render cameras" dialog:
   - choose cameras with checkboxes
   - choose the extra references
   - build the items with the production builder (master + anchor per camera)
   - show the item count and cost hint text (number of remote calls)
   - the result is shown on the Contact Sheet

6. **Jobs tray.** In `TRAY_TABS` set `availableIn: null`.
   - Show the active jobs and the recent history for all projects, filterable to the current project.
   - Each row shows: label, project, provider/model, status, attempt `n/max`, the next-retry countdown, elapsed time and the error.
   - Row actions: Cancel and Retry.
   - The top bar gets a queue indicator showing running and queued counts.

7. **Tests.**
   - The store with events: a queued job → running → completed, which updates history and assets.
   - Cancel and retry.
   - Concurrency in the mock.
   - Camera geometry math: azimuth/distance ↔ SVG position, round-tripped.
   - Batch dialog item building.
   - Contact Sheet grouping.

## Done when

- `npm run verify` is green on your branch, with domain helpers stubbed as needed. The backend fixture test may fail until P3-A merges; say so.
- Checked in the browser preview on port 1421 at 1366×768, if the browser tools are available.
- `docs/agent-notes/p3-ui.md` is written.
- Small commits.
