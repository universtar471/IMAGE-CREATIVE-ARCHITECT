# wt/p3-ui — P3-C UI: Camera module, Camera Director, anchors, batches, Contact Sheet, Jobs tray

- Agent: claude
- Branched from: `wt/p3-base` (097e424)
- Brief: `docs/agent-tasks/p3-ui.md`; plus the extra items from `docs/agent-reviews/p2-ui.md` (main)

## Goal

Phase 3 UI on the job queue: Generate goes through the queue, a functional Camera module with
the Camera Director, the anchors workflow, production batches, the Contact Sheet and the Jobs
tray. Also the Codex review items of the Phase 2 UI, applied to the new code paths.

## Done (commits in order)

1. `e2da1fb` Bridge + mock: §10 commands, `subscribe(event, handler)`, mock job queue.
2. `e33e93c` Generate on the queue: queued submit, events, live status, cancel/retry.
3. `5efe7ca` Jobs tray + top-bar queue indicator.
4. `903f485` Camera module: list/editor, Camera Director, batch dialogs, Contact Sheet.
5. `16aa4a9` Tests: mock queue + store events.
6. `57dd663` Tests: geometry, batch planning, anchors, Contact Sheet grouping.
7. `ba9f3d1` Align stand-ins with P3-B signatures and the mock with P3-A behavior
   (+ review p2-ui PHẢI SỬA 1, mock part).
8. `f1b3a8c` Review p2-ui fixes + regression tests (PHẢI SỬA 2–4, NÊN SỬA 1–5).
9. `4d97558` Contract test requires fixtures for every §10 command.

### Pieces

- **Bridge** (`lib/bridge.ts`). It parses the 8 new commands with the domain schemas.
  - `subscribe(event, handler) → unsubscribe` uses Tauri `listen` in the app, or the
    transport's `connectEvents` (the mock).
  - It re-binds when `setTransport` changes the transport.
  - Payloads are parsed with `JobDTOSchema` / `GenerationDTOSchema`. Malformed ones are dropped
    with a `console.warn`.
- **Store** (`app/store.ts`).
  - `jobs` holds every project's jobs.
  - The workspace carries `anchors` and `batches`.
  - `run` is `submitting | tracking | error`. A tracked generation is kept current by events.
  - `startBackendSync()` wires the events. `App` calls it once and also polls `job_list` every
    4 s while any job is active. `refreshJobs` resyncs the project when it sees a job finish
    that it never got an event for.
  - Actions: `cancelJob`, `retryJob`, `retryGeneration` (uses `job_retry`; Phase 2 rows are
    resubmitted), `createBatch`, `setAnchor`, `clearAnchor`, `setCameras`, `selectCamera`,
    `showContactSheet`.
  - `centerView` gains `director` and `contact`.
- **Mock** (`lib/mockBackend.ts`). It implements the queue faithfully:
  - per-provider slots (local 2, remote 1), priority then age
  - retry with backoff `[1.5 s, 6 s]` by default (tests use ms); only `rate_limited`, `network`
    and `timeout` retry
  - `[fail]` gives `bad_response`; `[flaky]` fails once with `rate_limited`, then succeeds
  - cancel; a running result is discarded and its slot stays busy until the "call" returns
  - restart recovery from localStorage, batches (all-or-nothing, `details.itemIndex`),
    anchors, ADR-016 status, and events
- **Generate.** Submit returns `queued`. The button is blocked only while submitting. A
  "Current generation" card shows status, attempt n/max, the retry countdown, elapsed time and
  Cancel. History rows are live, with Cancel/Retry and a camera badge.
- **Camera module** (`features/camera/*`).
  - Panel sections: "Anchors & production" (Generate anchors / Render cameras / Contact Sheet,
    with the disabled reason), "Cameras" (add from preset or blank, select, anchor-view
    toggle, duplicate, delete with confirm), the field editor (DNA autosave, field errors at
    `cameras.N.field`), and "Camera prompt" (compiled from saved data with master + anchor).
  - Center tabs: Camera Director | Image | Contact Sheet | Prompt Preview.
- **Camera Director** (`CameraDirector.tsx`, `geometry.ts`).
  - SVG plan in metres with distance rings. The footprint comes from the DNA width/depth or a
    12×10 m default (labelled). The front facade is blue and labelled.
  - Each camera has a view cone from its lens, aimed at the centre, and an elevation badge.
  - Anchor views are diamonds (amber). Anchored cameras have a green dot. Cameras without a
    set position are dashed. The selected camera is blue.
  - Drag with pointer capture (snaps to 1° and 0.5 m). The frame is frozen during a drag.
  - Keyboard: ←/→ orbit 5° (Shift 1°), ↑/↓ distance 1 m (Shift 0.5 m).
- **Batch dialogs** (`BatchDialog.tsx`, `batch.ts`).
  - Choices: provider, model, fallback aspect, image size, images per camera, cameras and
    extra references (production).
  - Shown: item count, cost hint and the first blocking issue.
  - On submit: `flushDna` → `project_get` → build from that snapshot → `batch_create` → opens
    the Contact Sheet for that batch.
- **Contact Sheet** (`ContactSheet.tsx`, `contactGroups.ts`).
  - A batch selector and live counts. Groups per camera in DNA order; retries appear after the
    attempt they replace.
  - Large thumbnails with "Approve as anchor" (anchor views only), Compare (side-by-side with
    the master) and open in the canvas.
  - Pending and failed cards show the job status with Cancel/Retry.
- **Jobs tray** (`features/jobs/JobsTab.tsx`). Scope "This project / All projects". Active
  jobs first. Each row shows label, project name, provider/model, status, attempt, retry
  countdown, elapsed time, error, Cancel and Retry. The tray tab has an active-count badge.
  The top bar has a queue indicator ("N running · M queued") that opens the tray.
- **Shared Dialog** now manages focus: initial focus inside, Tab trapped in the topmost dialog,
  focus restored on close.

## Stand-ins awaiting P3-B — `apps/desktop/src/lib/cameraDomain.ts` (all `TODO(p3-domain)`)

The signatures match the P3-B note (wt/p3-domain). At merge, delete the file and switch the
imports to `@arch/domain`:

- `newCameraId`, `uniqueCameraName`
- `cameraFromPreset(preset, existingNames?, id?)`, `blankCamera(existingNames?, id?)`,
  `duplicateCamera(camera, existingNames?, id?)`
- `anchorViews`, `cameraReadiness`, `azimuthWords`, `cameraSectionText`
- `paramsForCamera`, `buildAnchorBatchItems(input)`,
  `buildProductionBatchItems(input, cameraIds, anchors)`, the `BatchAsset` and
  `BatchBuildInput` types
- `compileCameraPrompt` → `compilePrompt` (with `cameraId` + `PromptReference.isAnchor`)
- `orderCameraReferences` → `sortReferences`
- `CameraPromptReference` / `CameraCompileInput` → `PromptReference` / `PromptCompileInput`
- `FALLBACK_CAMERA_PRESETS` → `knowledge.cameraPresets(type, subtype)`. Every pack has presets
  on P3-B, so the fallback branch in `CameraPanel` can go.
- Also consider `MAX_BATCH_ITEMS` (`batch.ts` hardcodes 50) and `CAMERA_VIEW_TYPE_LABELS`
  (`features/camera/labels.ts` has its own).

Expect a few test adjustments at the swap:

- P3-B's `blankCamera` names "Camera N".
- P3-B's prompt wording differs from the stand-in. `camera.test.ts` matches
  `/Camera: …/` and `APPROVED ANCHOR` for the anchor reference line; adapt the regexes to
  pc-1.1.0 text.
- The stand-in tests in the "camera helpers" and "camera prompt section" describes can then be
  deleted (P3-B tests the real ones).

## Assumptions about backend events / JSON (checked against the wt/p3-backend note + fixtures)

- Events `job://updated` (JobDTO) and `generation://updated` (GenerationDTO), payload = the DTO
  in camelCase. The UI does not depend on their order or pairing. It upserts by id. A
  generation leaving `queued`/`running` triggers an asset + project refresh (for completed),
  plus a batch refresh.
- A retrying job's generation is `queued` with `error: null`. The UI shows the job's error
  while waiting. `startedAt` is the latest attempt's start (null while waiting).
- Statuses that `job_retry` accepts: failed, cancelled and interrupted. The UI only offers
  Retry on a generation when it is cancelled or its error is `retryable`.
- Project status can change on `dna_update`, anchor set/clear, master change and asset removal.
  The UI adopts the `dna_update` response and re-reads `project_get` after the other three.
- `batch_create` errors may carry `details.itemIndex`. The UI shows the backend message (the
  mock prefixes "Item N (label)").
- All 21 fixtures on wt/p3-backend parse with this branch's bridge schemas. I checked from a
  temporary copy; `tests/fixtures/backend` was not touched.

## Decisions (ambiguities resolved here)

- **Distance** is measured from the footprint centre (editor hint says so). The azimuth
  convention is the domain's: + = clockwise from above = viewer's left (front at the bottom).
- **Generate** no longer blocks while a job runs. Several submissions just queue. Only the
  compile/enqueue step is exclusive.
- **Toasts** are raised only for the Generate panel's own tracked generation (finished or
  failed). Batch items do not toast individually (the Contact Sheet and Jobs tray are live).
  "Batch queued" toasts once.
- **Production defaults** to all cameras ticked. Extra references exclude images that are
  already an anchor (each camera gets its own anchor anyway).
- **Batch params.** The batch dialog's aspect ratio is a fallback; each camera's ratio wins
  when the model offers it (the builder rule).
- **"Master approved"** in the UI = status in master_approved | anchor_generation |
  design_locked | production | qc | final (`ProjectDTO` has no approval timestamp).
- **Anchor-view flag.** Deleting a camera releases its anchor (the backend drops it on
  `dna_update`; the UI re-reads anchors after any save that changed cameras).
- **Reuse settings** on an anchor/production generation keeps provider/model/params but resets
  the purpose to the default (Generate offers hero/variation only).

## Still open

- `backendContract.test.ts` is red here (5 tests). It needs P3-A's regenerated fixtures. It
  turns green after the merge; verified with a temporary copy of the fixtures.
- The domain project has 1 red test from the base contract change. P3-B fixes it.
- `npm run verify` therefore is not green on this branch alone. On the merged result it should
  be (P3-B → P3-A → P3-C).
- Not done:
  - multi-select or reordering of cameras
  - a "clear anchor" button in the UI (the store action exists; approving another image
    replaces the anchor)
  - polish of the Director on very small panels
- Visual check: done in the browser preview at 1366×768, but through DOM and layout
  inspection only. Screenshots timed out because the preview pane was hidden. See "Visual
  verification" below.

## Visual verification (browser preview, vite on :1421, 1366×768)

I seeded a villa with an approved master and drove the UI, checking through the DOM:

1. Three fallback presets added from the dropdown. They show in the list and on the Director
   (3 marks; front below the footprint, +az to the left). Autosave reached "Saved".
2. Layout: no horizontal overflow. Center 890×499, panel 300 px, tray 185 px. The dialog fits
   (682 px tall).
3. Generate anchors queued 2 items. The queue showed "2 running · 0 queued" (local 2
   concurrent). The Contact Sheet showed live "Generating… attempt 1/3", then 2 outputs.
4. Approve as anchor ×2 moved the status badge Master approved → Anchor generation →
   Production. The panel showed "2/2 anchored".
5. Render cameras queued 3 items. Anchored cameras got refs [master, anchor] and the camera's
   aspect ratio. The aerial camera got [master] and 16:9. Each prompt had the camera section.
6. Jobs tray: 5 rows, with project name, provider/model, attempt and elapsed time.
7. Generate with `[flaky]` in the DNA notes: the job went to retrying with rate_limited, then
   completed on attempt 2. The result card showed it.

## Test commands

```
npm install                       # once, at the worktree root
npm run typecheck
npm run lint
npx vitest run --project desktop  # 120 tests: 115 pass, 5 = contract fixtures (P3-A)
npx prettier --check apps/desktop
npm --prefix apps/desktop run dev -- --port 1421 --strictPort   # browser preview (mock)
```

## Pitfalls hit

- Windows is case-insensitive: `contactSheet.ts` next to `ContactSheet.tsx` made TS resolve
  the wrong module, so the pure file is `contactGroups.ts`.
- Python `open(..., "w")` on Windows writes CRLF. Use `newline=""`. Long Git Bash heredocs
  break on quotes: write helper scripts to the scratchpad with the Write tool.
- zustand selectors must return stable values. Counts use primitives; the queue indicator
  uses `useShallow`.
- The mock emits events synchronously inside the command, so a `generation://updated` can
  arrive before `generation_submit` resolves. The store keeps the most advanced copy.
- jsdom has no `getScreenCTM`, so Director drags are tested through the pure geometry, not
  pointer events.
