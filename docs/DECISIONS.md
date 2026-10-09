# Architecture Decisions

Use this file as a lightweight ADR log.

## ADR-001 — Structured DNA is canonical
Status: accepted

Prompt text is derived from structured project data. Provider-specific prompts must never become the only representation of project intent.

## ADR-002 — Provider-neutral core
Status: accepted

Domain data cannot depend on Gemini, OpenAI, Claude, FLUX, Stability, Topaz or browser UI structures.

## ADR-003 — Local-first Phase 1
Status: accepted

Phase 1 uses local SQLite + managed local files. Cloud synchronization is deferred.

## ADR-004 — Original image immutability
Status: accepted

Imported originals are copied into managed storage and never overwritten by edits/upscales. Derived results create new assets with lineage.

## ADR-005 — Zod schema source of truth
Status: accepted

Use Zod for runtime domain validation and inferred TypeScript types. Future JSON Schema for AI structured outputs should derive from the same model where feasible.

Implemented: `packages/domain` holds the Zod schemas. `npm run schema:export` writes
`packages/domain/schema/project-dna.schema.json` (Zod `toJSONSchema`, output mode,
draft 2020-12). A domain test fails if the checked-in file drifts from the Zod schema.

## ADR-006 — Browser automation deferred
Status: accepted

Browser automation is an optional future provider adapter, not the core architecture.

## ADR-007 — UI/UX shell is Phase 1 architecture
Status: accepted

The Project Hub, stable Project Workspace, reusable center canvas, contextual right properties panel and bottom production tray are implemented before provider integration.

Reason:
Future Camera, Lighting, Mood, Generate, Enhance and QC modules must plug into a stable interaction architecture without forcing a navigation/workspace redesign.

Phase 1 builds structural UX only. Final visual polish and advanced interactions are deferred.

## ADR-008 — Split of responsibilities between TypeScript and Rust
Status: accepted (Phase 1)

Context: Zod (TypeScript) is the schema source of truth, while SQLite access must live
behind the Tauri/Rust backend. Duplicating the DNA model as Rust structs would create two
sources of truth.

Decision:
- **Rust backend** owns persistence and file integrity: migrations, repositories, managed
  storage, import (format sniffing, dimensions, SHA-256, thumbnail, rollback), the
  single-master invariant, archive read-only rules and project status derivation.
  DNA is stored as validated JSON; Rust validates it against the JSON Schema exported from
  Zod (`jsonschema` crate) before every write. Rust never interprets DNA beyond the few
  readiness fields used for status.
- **TypeScript domain package** owns the DNA model, Knowledge Pack resolution
  (`createInitialDNA`) and the Prompt Compiler. These are pure functions with no UI, Tauri
  or SQL imports (enforced by ESLint `no-restricted-imports`).
- The UI application service `compilePromptPreview(projectId)` always loads **persisted**
  data via `project_get` and then compiles; it never compiles unsaved form state.
  This satisfies "backend data is canonical" without a second compiler in Rust. If a
  future headless/batch worker needs prompts, it reuses `@arch/domain` (Node) rather than
  re-implementing the compiler.
- Knowledge Packs are bundled into the UI at build time (`import.meta.glob`), so no
  `knowledge_*` Tauri commands exist yet. Project creation sends fully resolved DNA to
  `project_create`, which validates and inserts project + DNA in one transaction.

Consequence: the readiness rule (`dnaReadiness` in TS, `dna_is_ready` in Rust) exists in
both languages and is covered by tests on both sides; keep them in sync.

## ADR-009 — Project status is derived, not free-form
Status: accepted (Phase 1)

Phase 1 status is computed from persisted facts on every relevant write:
archived → `archived`; master + approval → `master_approved`; master → `master_pending`;
DNA minimum present → `dna_ready`; otherwise `draft`. Approval is an explicit action
(`project_approve_master`) stored as `projects.master_approved_at` and reset whenever the
master changes. This makes impossible transitions unrepresentable instead of checked.
Later phases (concepting, production, qc, final…) will extend the derivation or add
explicit transitions with a documented table.

## ADR-010 — Duplicate imports require an explicit choice
Status: accepted (Phase 1)

`asset_import` rejects a binary whose SHA-256 already exists in the project with
`DUPLICATE_ASSET` (details carry `existingAssetId`). The UI asks the user; only an explicit
"Import anyway" retries with `allowDuplicate: true`, creating a second logical asset.

## ADR-011 — Master uniqueness enforced twice
Status: accepted (Phase 1)

The asset service routes every master change (`asset_set_master`, `asset_update_role`,
import with role master, removal of the master) through one function that demotes the old
master to `architecture_reference`. Additionally, a partial unique index
(`idx_assets_one_master`) makes a second master impossible at the database level.
`projects.active_master_asset_id` has no FK (it would be cyclic); ownership is checked in
the service.


## ADR-012 — First image provider: Google Gemini, plus an offline provider
Status: accepted (Phase 2)

Phase 2 ships two providers behind one Rust trait (`ImageProvider`):
- `gemini` — Google Gemini image models through the public REST `generateContent` API.
  Chosen first because it accepts several reference images in one request (matches the
  reference-role model) and needs only an API key.
- `local_preview` — offline, deterministic placeholder renderer. No key, no network, no cost.
  It keeps the generation flow (persistence, lineage, history, UI) testable end to end.
Adding a provider = one new file in `src-tauri/src/providers/` + one registry line.
Vendor request shapes never leave that folder.

## ADR-013 — Provider calls and secrets live in the Rust backend
Status: accepted (Phase 2)

Adapters run in Rust, not in the webview, so API keys never enter JavaScript memory,
zustand state, localStorage or logs. Keys are stored in the OS credential store
(Windows Credential Manager / macOS Keychain) via the `keyring` crate, service
`com.archaistudio.desktop.provider`, account = provider id. An environment variable
`ARCH_STUDIO_<PROVIDER_ID>_API_KEY` is a read-only fallback for development.
SQLite stores no secrets; `request_json` snapshots are provider-neutral and key-free.
The UI can set, clear and test a key but can never read it back.

## ADR-014 — Synchronous generation with persisted history (no job queue yet)
Status: accepted (Phase 2)

`generation_submit` persists a `running` generation row, releases the DB lock, calls the
provider inside `spawn_blocking`, then stores outputs as managed assets in one transaction
and marks the row `completed` (or `failed` with a typed provider error). Provider failures
are history entries, not bridge errors; only invalid requests return `AppError`.
Rows still `running` at startup become `interrupted`. The Phase 3 job queue replaces the
synchronous call without changing the `generations` table or the DTOs.

## ADR-015 — Generated-output lineage
Status: accepted (Phase 2)

Every generated image is a normal managed asset: `source = ai_generated`,
`role = regular_image`, `operation = generate`, `parent_asset_id` = the generation's parent
(the master if referenced, otherwise the first reference, otherwise none).
Each output also gets a version whose `parent_version_id` is the parent asset's latest
version and whose `generation_id` points at the generation. Promoting an output to master
uses the existing `asset_set_master` invariant (ADR-011). Project status derivation is
unchanged in Phase 2.

## ADR-016 — Cameras live in the DNA; anchors are backend facts
Status: accepted (Phase 3)

Camera definitions (`CameraDNA[]`, ids `CAM_<ULID>` generated by the UI) stay in the DNA
aggregate: they are design intent, edited and autosaved like the rest of the DNA, compiled
into prompts in TypeScript (ADR-008) and validated by the exported JSON Schema.
An **anchor view** is a camera flagged `isAnchorView`; its **anchor** is an approved image
for that viewpoint, stored in `camera_anchors` (one per camera, FK cascade on the asset) so
removing an asset can never leave a dangling anchor and autosave can never race with
approval. `dna_update` drops anchors whose camera no longer exists.
Production renders of an anchored camera include the anchor as a reference right after the
master. Status derivation: master approved + ≥1 anchor view → `anchor_generation`; every
anchor view anchored → `production`.

## ADR-017 — Persistent job queue with controlled concurrency and retries
Status: accepted (Phase 3)

Every generation runs as a job (`jobs`, 1:1 with `generations`). `generation_submit` now
only enqueues and returns the `queued` generation. A backend worker loop (std threads)
picks the highest-priority oldest runnable job whose provider has a free slot:
`local` providers 2 concurrent, `remote` providers 1 (constants in one place).
Retryable provider errors (`rate_limited`, `network`, `timeout`) are retried up to
`max_attempts = 3` with backoff 15 s, 60 s (`retrying` + `nextAttemptAt`); others fail
immediately. Exception (2026-10-09): a provider may opt out of automatic `timeout`
retries (`ImageProvider::auto_retries_timeouts`); OpenAI-compatible gateways such as HHTECH
do, because a gateway can keep rendering and bill a call the app stopped waiting for; the
job fails at once and the user decides whether to press Retry. Cancel: a queued/retrying job becomes `cancelled` at once; a running job is
marked `cancelled` and its result is discarded when the provider call returns.
On startup `running` jobs become `interrupted` (never re-sent automatically: remote calls
cost money); `queued`/`retrying` jobs resume. The backend emits `job://updated` and
`generation://updated` events; the UI also refreshes from `job_list`.

## ADR-018 — Batches are named groups of independent jobs
Status: accepted (Phase 3)

A batch (`batch_create`) is one provider/model/purpose plus 1–50 items; each item carries its
own compiled prompt, ordered references, params and optional camera, and becomes one job.
The UI compiles every item (ADR-008). Items fail or succeed independently. The Contact Sheet
shows a batch's (or a camera set's) outputs side by side for selection and anchor approval.

## ADR-019 — Lighting, weather and mood are prompt DNA with pack presets
Status: accepted (Phase 4)

`lighting`, `weather` and `mood` stay optional sections of the DNA aggregate (schema v1
shapes from Phase 1, extended additively). They are design intent sent to the image model,
so the TypeScript compiler (ADR-008) renders them; compiler `pc-1.2.0` emits three separate
sections (Lighting, Weather, Mood) instead of the Phase 1 combined line, plus artificial
lighting zones. Knowledge packs gain `lightingPresets`, `weatherPresets` and `moodPresets`
(pack 1.2.0): each preset has a stable id, a label, tags (e.g. `tropical`, `monsoon`,
`dry_season`, `night`) and a partial section that the UI merges into the DNA; the DNA keeps
the chosen `presetId` for display only (the resolved values are what is compiled, ADR-001).
Locks: `LockState` gains `mood` (default false). A locked lighting/weather/mood section is
read-only in the UI, is never varied by mood variations, and adds a preservation line
("Lighting DNA is LOCKED: …") to every prompt.

## ADR-020 — Color grade is a deterministic local post-process
Status: accepted (Phase 4)

`colorGrade` is never sent to a provider and never enters the prompt. Grading runs on the
user's machine with one pixel pipeline defined in `docs/API_CONTRACTS.md` §12.3, implemented
twice: in TypeScript (`@arch/domain` `grade/`) for the live canvas preview, and in Rust for
the full-resolution result. Both are checked against the same test vectors
(`packages/domain/test-vectors/grade.json`) with a tolerance of ±1 per 8-bit channel.
`grade_apply` writes a NEW asset (the source is never modified) plus a version with
`operation = "color_grade"`, `operation_json` = the grade, `parent_version_id` = the
source's latest version. The new asset takes role `regular_image` and never becomes master
automatically. The DNA `colorGrade` section stores the project's current grade so the same
look can be applied to every camera.

## ADR-021 — Mood variations are batches over one source image
Status: accepted (Phase 4)

"Mood variations" re-render one source image (the master or a chosen output) under several
lighting/weather/mood presets. It is an ordinary batch (ADR-018, purpose `variation`): one
item per preset, the source first as the master/anchor reference, a prompt compiled with
that preset's sections overriding the DNA and a preservation instruction to keep the
architecture, camera and composition and change only light, weather and atmosphere.
Locked sections are not overridden. Choosing a result ("Adopt this mood") writes that
preset's sections into the DNA; nothing is written before the user adopts.

## ADR-022 — Guided workflow: stages, ordered steps, confirm-and-lock
Status: accepted (Phase 4B, requested by the user after testing Phase 4)

The workspace is a guided pipeline so users cannot run steps out of order:

1. **DNA thiết kế** (stage `dna`): Kiến trúc → Bối cảnh → Tham chiếu → Góc máy → Ánh sáng. Each is a sub-tab.
2. **Tạo ảnh** (stage `generate`): Ảnh Master → Anchor → Render các góc máy.
3. **Hậu kỳ** (stage `post`): Mood / Chỉnh màu (and later Enhance, QC).
4. **Tổng quan** summarises every step, allows quick edits of key fields, and links to each sub-tab.

**Confirming a step.**
- A DNA step is finished with "Xác nhận & khoá". Defaults are acceptable: an untouched step can be confirmed.
- A confirmed step is read-only until "Mở khoá".
- Reopening a step marks every LATER confirmed DNA step `needs_review`. Generated images are never deleted.

**Viewing a locked step.**
- A step whose prerequisite is unmet can be viewed but not edited or run.
- It shows a banner naming the blocking step, with a button to jump there.

**Generate-stage steps are derived from data, not confirmed by hand.**
- Master is done when the project has an approved master.
- Anchor is done when every anchor-view camera has an approved anchor. It is skipped when no camera is an anchor view.
- Camera setup (defining views) stays in DNA › Góc máy.
- Creating and approving anchors and rendering cameras move to the Tạo ảnh stage.

**Post stage** needs an approved master only, not the DNA confirmations, so grading existing images never depends on DNA edits.

**Workflow locks vs. prompt locks.** Workflow step state is separate from the DNA `LockState`, which keeps meaning "preserve this section in prompts, presets and variations". In the UI the prompt lock is renamed "Ghim" (pin) so the two kinds of lock are not confused.

**Enforcement.**
- Edits are enforced in the UI.
- Generation is also enforced in the backend:
  - `hero` needs all DNA steps confirmed.
  - `anchor` additionally needs an approved master.
  - `production` additionally needs anchors done or skipped.
  - `variation` needs an approved master only.
- "Dùng mood này" in the post stage may update confirmed lighting/weather after an explicit confirmation dialog. It is a deliberate change of direction, and the step stays confirmed.

## ADR-023 — Enhancement: conservative local upscale and generative detail through edit providers

Status: accepted (Phase 5; planned by the lead overnight on the user's instruction to continue to the next phase)

Enhancement takes one ready image and produces a NEW asset and version (`operation = "enhance"`). The source is never modified (ADR-004). There are two modes.

**`conservative`**
- A local, deterministic, free resize to a target long edge: Lanczos3 from the `image` crate, then a mild unsharp mask scaled by detail strength.
- It runs as a job on the local lane (ADR-017 local concurrency) with provider id `local_upscale`.
- No network, no prompt.

**`generative`**
- An image edit through an existing remote provider that supports image-to-image (HHTECH, OpenAI, Gemini).
- The source is the only reference and has the master role semantics.
- The prompt is built by the domain from:
  - an **Architecture Preserve** instruction (default on): keep geometry, openings, proportions, materials, camera and composition exactly; add only fine detail and texture, and fix soft or noisy areas
  - a detail-strength wording bucket (low / medium / high)
  - a short DNA material summary
- With Architecture Preserve off, the wording allows richer generative detail but still forbids changing the building.
- The provider's own output size is not exact (gateway tiers). The job therefore finishes with the same local Lanczos resize to the requested long edge, so every enhance output has an exact long edge.
- HHTECH default model: Gemini 3 Pro Image at the 4K tier when the target long edge is greater than 2048, otherwise 2K. It is the best measured geometry preservation; see `docs/agent-notes/hhtech-models.md`.

**Shared mechanics**
- Long-edge targets: 2048, 3072, 4096 (and "keep" for generative detail at the source size). Hard cap 8192.
- Enhancement uses the existing generation and job pipeline with a new generation purpose `enhance`.
- Batch enhancement is an ordinary batch (ADR-018), with one item per selected image.
- Workflow gating (ADR-022): `enhance` needs an approved master, like `variation`.
- The UI lives in Hậu kỳ › Nâng cấp. A compare view shows source and result with before / after / split, generalising the grade preview's compare.
