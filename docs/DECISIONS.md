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

## ADR-024 — Vision QC: free local metrics plus an optional AI vision judge, repair as a generation

Status: accepted (Phase 6; planned by the lead overnight on the user's instruction to continue to the next phase)

QC scores a ready image against its references and stores a report. It never modifies assets.

**References**
- If the asset came from a generation, the references are that generation's reference assets, in order.
- Otherwise the reference is the project master.
- The first reference is the primary one.

**Local metrics** — always run, free, deterministic:
- `edgeAlignment` (0–100): Sobel edge maps of the output and the primary reference, both downscaled to a 512 px long edge and the same size. Each map is dilated by 2 px, then the score is the IoU × 100.
  - Only meaningful when the output shares the reference's viewpoint. It is computed only for purposes `enhance`, `variation`, `repair`, and for `color_grade` outputs; otherwise `null`.
- `sharpness` (0–100): variance of the Laplacian on the 512 px grey image, mapped with `min(100, var / 4)`.
- `clippedPct`: percent of pixels with any channel at 0 or 255.

**Vision judge** — optional and paid; runs only when the user picks a vision provider:
- Uses a chat-completions call with image content parts. Images are JPEG q85, 1024 px long edge, sent as data URLs.
- Supported on the HHTECH and OpenAI providers, through their chat model. HHTECH reads `HHTECH_VISION_MODEL`, falling back to `HHTECH_CHAT_MODEL`.
- A fixed English system prompt asks for strict JSON:
  - `scores {geometry, material, openings, context, lighting}`, each 0–100
  - `artifacts [{label, severity, box}]`: severity is `low|medium|high`; `box` is `[x,y,w,h]` normalised 0..1, or null
  - `issues [{category, text}]`
  - `repairInstruction`: a string
- The reply is parsed leniently: take the first JSON object and validate it. If it is unreadable, the run fails with a clear `bad_response` error.
- Vision support was not live-verified during planning. A `#[ignore]` live test documents how to check it.

**Result**
- `overall` = mean of the vision category scores. Without vision it is `edgeAlignment`; otherwise `null`.
- `result` is one of:
  - `fail`: any vision category is below `categoryMin`, `overall` is below `passMin`, or a `high` artifact exists while `highArtifactFails`
  - `warn`: no failure, but `overall` is less than `passMin + 10`
  - `pass`: no failure or warning
  - `unscored`: no `overall`
- Thresholds are per project (`qc_settings`). Defaults: `passMin` 70, `categoryMin` 55, `highArtifactFails` true.

**Repair**
- "Sửa theo QC" is a generation with purpose `repair`. References:
  1. the failed output (master semantics, so the model edits it)
  2. the original primary reference
- The prompt comes from domain `buildRepairPrompt({ dna, report })`:
  - the report's issues and `repairInstruction`
  - preservation lines: keep everything not listed
- Gating is the same as `variation`.

**Automation** — per project, off by default because it spends credits:
- `autoQc: "off" | "after_generation"`: when on, every successful output of any generation, repair outputs included, gets a QC run using the project's chosen vision provider/model, or local metrics only if none is set.
- `autoRepairMax` (0–2, default 0): when a report fails and the repair chain of that output is shorter than the max, a repair generation is queued with the same provider/model as the original. The chain depth is recorded in generation meta.

QC lives in Hậu kỳ › QC. The canvas can overlay artifact boxes.
- Operational note: QC work in flight on a detached automation thread is not resumed after an app restart; no automation state is persisted.

## ADR-025 — Region editing: per-asset regions, project scene objects, masked edits always composited locally

Status: accepted (Phase 7; planned by the lead overnight on the user's instruction to continue to the next phase)

**Regions**
- A region is a shape drawn on one asset: rectangle, polygon or brush strokes.
- Coordinates are normalised 0..1 to the asset's pixel size.
- Regions are stored per asset in a `regions` table.
- A region has:
  - a label
  - a kind: `object`, `zone` or `material`
  - an optional link to a project scene object

**Scene objects**
- They live in the DNA as an additive `scene` section: `objects[{ id: OBJ_<ULID>, name, category, material?, relations[{ type, targetId }] }]`.
- They give stable object IDs across images.
- The existing `LockState.objectIds` pins objects. A pinned object adds a preservation line to every prompt.
- The scene section is not one of the five guided DNA steps. It stays editable at any stage.

**Masks**
- Masks are rasterised deterministically from regions:
  - rectangle and polygon use even-odd fill
  - brush draws round strokes of a given radius
- The rules are implemented in TS (UI preview and mock) and in Rust (backend), checked against shared test vectors.
- A union of the selected regions forms the edit mask.

**Selective edit**
- A selective edit is a generation with purpose `region_edit`. The asset is the only reference.
- `params.region` holds:
  - `regionIds`
  - `instruction`
  - `mode`: `edit` or `material_replace`
  - `material`: required when `mode` is `material_replace`
- Providers whose model advertises `supportsMask` receive the mask natively, following the OpenAI images/edits convention: transparent pixels = area to edit.
  - These are OpenAI official and the HHTECH GPT models.
  - Mask support was not live-verified during planning; a `#[ignore]` live test documents how to check it.
- Other models (Gemini) get the mask as a second reference image, plus an instruction to change only the white area.

**Composite rule (always applied)**
- Whatever the provider returns is resized to the source size.
- It is then composited over the source with the mask feathered by 8 px at the source scale.
- Pixels outside the edit mask are therefore guaranteed to stay the source's, for every provider.
- The output is a new asset and version with `operation = "region_edit"`. The source is never modified.

**Auto-select**
- Segmentation needs a model this app does not ship. The tool is shown disabled as "later" and is deferred.

**Gating**
- The same as `variation`: needs an approved master.
- The UI lives in Hậu kỳ › Chỉnh vùng.

## ADR-026 — Sketch / massing to render: a structure source role

Status: accepted (2026-10-10; user asked for an "from sketch / massing" mode after comparing with a competitor)

**Problem**
- The first image of a project came only from DNA text. Its geometry was whatever the model drew, so the master could disagree with the DNA (for example 1 floor instead of 2).
- Architects usually already have a SketchUp view, a massing model or a hand sketch.

**Decision**
- **New asset role `structure_sketch`** ("Phác thảo / khối"):
  - a sketch, massing screenshot or 3D-model view whose geometry and viewpoint must be kept
  - ranked right after `master_architecture` in `REFERENCE_ROLE_ORDER`
  - not part of the default reference selection, so it is only sent when chosen
- **Generate › Nguồn ảnh: "Từ mô tả DNA" | "Từ phác thảo / khối"**, a source toggle for Hero only.
  - In sketch mode, exactly one `structure_sketch` asset is pinned as image 1.
  - The aspect ratio follows the sketch.
  - The mode needs a model with image-to-image.
  - An inline "Nhập phác thảo" imports a file straight into this role.
- **Prompt (compiler):**
  - The `structure_sketch` instruction keeps its geometry, viewpoint, proportions, floor count, openings and roof form exactly. The model renders it photorealistically with the DNA materials, lighting and context, without adding or removing building parts.
  - The preservation section says to follow Image N (structure) for geometry and viewpoint.
  - When a master is also referenced, the master stays the authority for design, and the sketch drives the viewpoint and geometry of this shot.
- A hero rendered from a sketch can become the master as usual.
- No backend purpose change.
  - The backend accepts the new role everywhere roles are parsed.
  - Provider prompt text gets a role label.


## ADR-027 — Interior DNA: exact pick-lists in an additive `dna.interior` section

Status: accepted (2026-10-10, user request "ok nội thất"; taxonomy proposed by Codex in a read-only consult)

**Problem**
- Interior projects reused the building fields (roof, massing, facade) and free-text style and materials.
- The user (a Vietnamese architect) wants exact choices for:
  - building use
  - room
  - style
  - palette
  - materials per surface
  - interior lighting
  - furnishing
  - camera

**Decision**
- **Additive optional section** `dna.interior` with `schemaVersion: 1`.
  - The DNA aggregate version does not change.
  - Existing projects parse unchanged.
  - The section is only used when `project.projectType === "interior"`.
  - Every pick-list value is a stable id from one catalog in `packages/domain/src/interior/catalog.ts`. Each option carries `{ id, vi, en, prompt }`, where `prompt` is the English phrase for the compiler.
- **Cascades** are pure domain helpers.
  - The building use filters the valid rooms. `other` is always valid, and `prayer_room` (phòng thờ) is explicit for residential uses.
  - The style supplies a default palette and a material preset. Choosing a style fills in only the values the user has not set. The user can override any surface.
- **Compiler.** For interior projects with `dna.interior` set, the compiler emits interior lines (space, style, materials per surface, furnishing, interior lighting, camera preset) instead of the building massing and roof lines. It keeps the master-priority rules. The version bumps to `pc-1.4.0`.
- **UI**
  - For interior projects, guided step 1 is labelled "Không gian" (en "Space") and shows the interior pick-lists instead of the building massing fields.
  - "Bối cảnh" focuses on windows, view and daylight.
  - "Ánh sáng" adds interior scenes and colour temperature.
  - "Góc máy" offers the interior camera presets.
  - A moodboard preview shows palette chips and material swatches.
  - The new-project wizard asks for the building use, room and style for interior projects.
- **Migration.** There is none on disk.
  - When an interior project without `dna.interior` opens, the UI proposes a section by mapping the old free text to catalog ids where it matches exactly (case- and diacritics-insensitive). The user confirms before anything is saved.
  - The old fields are never deleted.
- **Deferred:** budget tier, advanced room constraints, and per-industry presets.


## ADR-028 — Anchors keep the master's surroundings: site topology, camera × context rules, view-aware prompts

Status: accepted (2026-10-10, user "làm cả 3"; audit by Codex read-only consult of all 55 pack × preset prompts)

**Problem**
- Anchors of a mid-block townhouse became corner houses: the left and right corner presets ask to show a side that is a party wall.
- The aerial anchor invented a street junction and redrew the neighbours.
- Every prompt of the townhouse pack said "street-level exterior view", even for the aerial view.
- The master reference protected only the building, never its surroundings.
- Style names were too vague: Mediterranean adds arches, Indochine adds colonial detail.

**Decision**
- **Site topology** is explicit, additive and optional:

  ```
  context.siteTopology = { left, right: "attached" | "open" | "unknown", cornerLot, cornerSide? }
  ```

  When it is absent, a pure helper infers it. A side is `attached` when its adjacent-building text says attached, party wall, liền kề, liền vách or sát vách; otherwise it is `unknown`. Explicit values always win.
- **Camera × context plan** (pure helper):
  - A camera that would reveal an attached side is rendered as an oblique street view with that side hidden.
  - An aerial over attached or high-density context keeps the same block.
  - Revealing an `unknown` side is allowed but flagged in the UI, so the user decides: attached, or corner lot.
  - A corner lot allows the side street only on the confirmed side.
- **Compiler pc-1.5.0**
  - The subject framing follows the camera's `viewType`.
  - For exterior projects, the master instruction preserves the visible surroundings as well as the architecture.
  - Conditional aerial and party-wall instructions.
  - Contextual negatives.
  - Expanded style phrases for known style names.
- **Packs**
  - Townhouse and urban-villa corner presets become oblique street views, and `street_level` is the recommended anchor.
  - Aerial compositions drop "plot".
  - Interior wide lenses are at least 20 mm.
  - The townhouse packs declare `siteTopology` attached on both sides.
  - Interior and exterior style and material phrases become precise.
- **UI**
  - Bối cảnh gets a "Vị trí lô đất" control.
  - The camera and anchor steps show each camera's plan, with one-click resolution when a side is unknown.
- **Existing projects.** The rules work on the stored DNA through inference; there is no migration. Stored camera compositions that contradict an attached side are overridden at compile time.

## ADR-029 — Lighter workflow confirmation, inline next step, visual previews

Status: accepted (2026-10-11). Source: user feedback after the first real anchor run.

**Problem**

- Going back to add an anchor camera forced the user to reconfirm every later step one by one, because ADR-022's reopen cascades `needs_review`.
- The next-step title showed raw i18n keys, and its floating hint overlapped the header.
- Thumbnails were cropped.
- Presets for lighting, mood/grade and context could not be imagined before spending credit.

**Decision**

- **Workflow.** Reopening a DNA step reopens only that step. DNA steps are independent inputs, and the master and anchor checks, such as MasterDnaCheck, already catch drift. Legacy `needs_review` rows can be reconfirmed in one click, or all at once.
- **Next step.** It is a compact button in the step header next to status, lock and confirm. Overview keeps the large card. Titles use flat i18n keys.
- **Image strip.** Thumbnails use contain instead of cover. Three view modes: small grid, large, list.
- **Compiler pc-1.5.1.** The oblique-street viewpoint states about 30–35° off the facade axis.
- **Previews.** These are free and local, with no API calls.
  - SVG scene previews for lighting and mood presets.
  - The colour grade is previewed live on the master image with a CSS or canvas approximation.
  - A top-down site diagram shows context and site topology.
  - AI sample photos per preset are deferred. They would need a paid one-off generation and user approval.


## ADR-030 — AI DNA assist (from a brief, reference images or the master), tidy Space panel, preset photos

Status: accepted (2026-10-11, user "đồng ý … làm thêm hình preview bằng comfyui")

**Problem.**
- The interior Space step is unreadable in the narrow right panel: the moodboard sits beside the fields, which leaves selects about 50 px wide.
- Users cannot translate a vision ("Japandi ấm cho gia đình trẻ") or a reference photo into the many pick-lists.
- The interior prompt had three faults:
  - Two floor materials split the floor in half.
  - The interior camera-preset fallback emitted the wrong camera text.
  - Vietnamese free text leaked into the English prompt.
- Exterior DNA drifts from the approved master (the old "DNA sync from master" backlog item).

**Decision.**

**AI assist** is one backend command with three modes.
- **Modes:**
  - `brief`: a free-text description.
  - `images`: up to 3 reference assets.
  - `master`: the approved master image.
- **Scopes:** `interior`, `building`, `context`, `lighting`.
- **Provider.** It calls an OpenAI-compatible chat model with vision through the HHTECH gateway, from Rust only. ADR-013 holds: the key never reaches the webview.
  - The model is set by `HHTECH_ASSIST_MODEL`, default `gemini-3.8-flash`.
  - It asks for JSON output.
- **Catalogue.** The webview sends the allowed catalogue (ids + English labels) built by a domain helper, so the model can only pick known ids.
- **Validation.** The domain validates the reply. Unknown ids are dropped; free text is clipped and English.
- **Proposal, not a write.** The result is shown as a diff ("Hiện tại → AI đề xuất"), each field with a checkbox, confidence and a short reason. Nothing is written until the user applies it, through the normal DNA edit and autosave path.
- **Cost.** It is shown in the spend confirmation (an estimate of a few tens of đồng) and goes into generation history as purpose `assist`, with no image output.
- **Translate.** A fourth mode, `translate`, turns Vietnamese free-text DNA fields into English for the prompt. The UI offers it when a free-text field contains Vietnamese diacritics.

**Space panel layout.**
- The moodboard stacks above the fields when the panel is narrower than 560 px.
- Fields are full width.
- Collapsible groups: Không gian · Phong cách & bảng màu · Vật liệu bề mặt · Đồ nội thất · Ánh sáng.
- Surface materials become chips. The first selected chip is the primary one.
- The right panel can be resized by dragging, between 320 and 720 px, and the width is remembered.

**Compiler pc-1.6.0.**
- In a slot with several ids, the first is primary and the rest are rendered as `with <x> accents`. Example: `floor: natural oak flooring with terrazzo accents`.
- The interior camera-preset fallback maps every `cameraPresetId` to its own prompt (fix the wrong mapping).
- Free-text fields that still contain Vietnamese are passed through unchanged. The UI flags them for translation instead of the compiler guessing.

**Preset photos.**
- Real photos are generated once, locally, with ComfyUI (RealVisXL + ControlNet canny on one base scene per family, so presets compare fairly):
  - lighting (exterior and interior)
  - mood (exterior and interior)
  - context presets
  - the 15 interior styles
- They are committed as small WebP files under `apps/desktop/public/previews/<kind>/<id>.webp`, listed in `apps/desktop/public/previews/manifest.json`.
- Preset cards show the photo when the manifest has one, otherwise the existing SVG preview.
- These images are our own generations, with no third-party assets.


## ADR-031 — Colour grade v2 on the LightCraft develop pipeline, style grade presets, user LUT library

Status: accepted (2026-10-11). Basis: the user approved, the LightCraft spike was a GO (`wt/lightcraft-spike`, `docs/agent-notes/lightcraft-spike.md`), and the user owns a The LUT Bay collection.

**Problem**
- The local grade (`services/grade.rs`, `packages/domain/src/grade`) only has exposure, contrast, temperature and saturation.
- It cannot recover skies or open shadows.
- Users cannot judge presets without previews.
- Users want to use colour LUTs they own.

**Decision**

**Engine**
- `lightcraft-develop` and `lightcraft-pipeline` are added as git dependencies, pinned to rev `964d9338bafac524146ecf24a1fab54bd22b052e`. Licence: MIT OR Apache-2.0; their NOTICE is kept in `THIRD_PARTY_NOTICES.md`.
- They sit behind one adapter module `services/grade_engine.rs`. No other module imports LightCraft types.
- The existing v1 fields map into LightCraft settings, so old grades still render.
- The TypeScript `applyGradePixel` stays as the v1 fast path and parity-vector reference. v2 previews come from the backend.

**DNA (additive)**
- `ColorGradeDNA` gains optional v2 fields:
  - light and colour: highlights, shadows, whites, blacks, tint, vibrance
  - effects: texture, clarity, dehaze, vignette, grain
  - `splitTone { shadowsHue, shadowsSat, highlightsHue, highlightsSat, balance }`
  - `toneCurve`: one of none, soft_s, strong_s, faded, matte
  - `lut { lutId, strength 0–100 }`
- Absent fields mean neutral. There is no migration of stored DNA.

**Style presets**
- Five presets: `earthy_muted`, `heritage_warmth`, `clean_editorial`, `tropical_forest`, `concrete_steel`.
- Each maps to interior and exterior styles for suggestions.
- Final values are tuned by rendering on a real master, not copied from the source text.

**LUT library**
- Users add folders they own.
- The backend indexes only `.cube` 3D LUTs (size ≤ 65). It stores paths and metadata, never copies or uploads the files, and never commits them.
- Previews are rendered locally on the chosen preview image and cached in app data.
- LUTs apply after the develop pipeline (trilinear interpolation, strength blend).
- Names containing Log, D-Log, S-Log or V-Log are flagged as made for log footage.
- An editable "architecture" filter hides unrelated categories (food, wedding, portrait…) by default.

**Live preview**
- `grade_preview` renders the selected asset at ≤ 640 px. LightCraft takes about 15 ms at 512 px, measured in the spike.
- The UI debounces the call at 120 ms and shows a before/after split.


## ADR-032 — Adopt the user's Color Grading Studio V5.2/V5.3 patch into the grade v2 UI

Status: accepted (2026-10-15). Basis: the user supplied `IMAGE_CREATIVE_ARCHITECT_COLOR_GRADING_V5_3_FULL_SOURCE`. It was built on `35f11c9` and adds 18 files, all TypeScript/React. Its specs are kept as `docs/COLOR_GRADING_STUDIO_V5_2.md` and `V5_3.md`.

**Context**
- V5.2 contains:
  - 30 v1 looks (`GRADE_LOOKS`) with bilingual metadata in six categories
  - a live thumbnail gallery rendered from the selected project image through the TypeScript v1 pixel path
  - an exposure slider range fix (−5..5 → −100..100)
  - a Split-view fix: `putImageData` ignores clip paths, so the patch uses the dirty-rectangle overload
  - manual slider edits clear `look`
- V5.3 contains a batch colour-grade dialog:
  - real thumbnails, filters, selection
  - one preset with an intensity from 0 to 100 %, plus preview
  - a sequential `grade_apply` queue with stop-after-current, resume and retry-failed
  - one `asset_list` refresh at the end
- The patch was never typechecked or tested in its origin environment.
- It predates ADR-028..031:
  - grade v2
  - LightCraft
  - the five style presets
  - the LUT library
  - the ADR-029 preview components

**Decision**
- The patch is applied with a 3-way merge onto `wt/grade-ui`, which branches from main after `wt/grade-core` merges. Conflicts are resolved toward current main.
- Preset gallery categories:
  - All, Natural, Warm, Cool, Editorial, Cinematic, Special (the 30 v1 looks)
  - **Hợp phong cách**: the five v2 style presets of ADR-031, flagged by `gradePresetsForStyle`
  - **LUT**: the user LUT library
- Thumbnail sources:
  - v1 looks keep the fast TypeScript thumbnails.
  - v2 presets and LUTs use the backend `grade_preview`/`lut_preview`.
- Overlapping names (for example `clean_concrete` vs `concrete_steel`) stay; they are different looks. The style group explains that it is matched to the project style.
- Batch grading accepts any `ColorGradeDNA`, including v2 fields and `lut`.
  - Intensity scales every numeric field linearly toward neutral.
  - `lut.strength` is scaled the same way.
  - `toneCurve` and `splitTone` hues are kept; split-tone saturations are scaled.
  - The backend `grade_apply` renders v2 through LightCraft, as for a single image.
- Batch grading never writes `draftDna.colorGrade`.
- Read-only or archived projects are refused, by the UI and by the existing backend guard.
- The batch queue lives in the dialog for now. A persistent backend batch job stays future work.

**Consequences**
- The `look` enum grows by 24 ids, so the JSON schema is regenerated.
- The Rust `ColorGrade.look` stays a free string.
- Parity vectors are unchanged, since looks are plain numbers.
- The grade-ui brief (`docs/agent-tasks/grade-ui.md`) is rewritten around this merge.

## ADR-033 — Remove the Vision QC / scoring feature

Status: accepted (2026-10-15). Basis: the user asked to remove the scoring feature because it is not needed.

**Decision**
- The Vision QC feature of ADR-024 is removed:
  - the workspace module, badges, next-step guidance, settings and auto QC
  - repair from a QC report
  - the `qc_*` commands
  - `services/qc.rs`
  - the vision provider calls used only by QC
- User data is never deleted. The QC tables and migrations stay unchanged and no drop migration is added, so old databases open as before.
- The generation purpose `repair` and its label stay, so old history displays. ADR-024 is superseded.


## ADR-034 — Master SRS 1.0, phases P0–P1: project facts, unified conflict validator, Space Catalog V3, site adjacency and visibility

Status: accepted (2026-10-15). Basis: the user asked to implement `IMAGE_CREATIVE_ARCHITECT_MASTER_SPEC_V7_2` (SRS 1.0), phases P0 and P1 first. The SRS describes an older snapshot (compiler `pc-1.3.0`, QC present). Main has since gained the following, and this ADR builds on them instead of duplicating them:
- ADR-027 interior DNA
- ADR-028 `context.siteTopology` and `cameraSitePlan`
- ADR-030 assist
- ADR-033, which removed QC

The SRS's `Building_Space_Catalog_V3.zip` (256 presets) is not available locally. P1 therefore ships the catalog infrastructure and a curated starter set, and imports V3 data when the user supplies it.

**P0 — foundation**

**Evidence** (`packages/domain/src/facts/`)
- `EvidenceRefSchema`:
  - `status`: `verified | user_declared | inferred | unknown`
  - `sourceAssetIds: string[]`
  - `approvedByUser?: boolean`
  - `confidence?: 0..1`
- Helper `isConfirmed(e)` is true for `verified` and `user_declared`.

**Project extensions** — all optional, versioned per extension, with `ProjectDNA.schemaVersion` staying `1`:
- `spaceCatalog?: { version: 1, buildingArchetype, spaces: SpaceInstance[], activeSpaceId? }`
  - `SpaceInstance`: `{ id, presetId, floorId?, label?, facts: Record<string, { value, evidence }>, lockedElementIds: string[], approvedOptionalIds: string[] }`
- `site?: { version: 1, coordinateConvention: "viewer_facing_front_facade", front, left, right, rear }`
  - Each side is a `SiteBoundary`: `{ kind: attached_building | street | open_space | boundary_wall | unknown, evidence, neighborObjectId?, heightRelation?: lower | similar | taller | unknown }`
- `architecturalDetails?: DetailRecord[]`
  - Schema only in P0. Planner, prompts and UI come in P2.

**Compatibility**
- An old DNA without extensions loads, saves and reopens byte-equivalent apart from defaults that already exist.
- Rust validation (`dna_validation.rs` via the generated JSON schema) accepts the extensions.
- Unknown future extension keys are rejected, as today.
- `context.siteTopology` (ADR-028) stays.
  - `resolveSiteAdjacency(dna)` reads `site` when present. Otherwise it derives sides from `siteTopology`:
    - `attached` → `attached_building`
    - `open` → `open_space`, or `street` on the `cornerSide` of a corner lot
    - `unknown` → `unknown`
    - front → `street`; rear → `unknown`
  - Derived sides have evidence status `user_declared` when they come from the UI toggles.
  - The UI writes `site` from now on and keeps `siteTopology` in sync for older code paths.

**Unified conflict validator** (`packages/domain/src/validation/`)
- `CONFLICT_CODES`: the SRS §12.4 table, with code, default severity, and vi/en message keys.
- `validateShot(input) → { verdict: BLOCK | WARN | ALLOW, issues: Issue[], validatorVersion }`
  - `input = { dna, shotIntent, extraPrompt?, approvedExceptions? }`
  - `Issue = { code, severity, path, messageKey, params, exceptionAllowed }`
- `VALIDATOR_VERSION = "cv-1.0.0"`.
- P0/P1 rules:
  - `SPACE_NOT_IN_BUILDING`
  - `UNVERIFIED_GEOMETRY`: WARN when a prompt or extra text asks for exact dimensions that are not verified
  - `ADJACENT_BUILDING_CONFLICT`: BLOCK when the camera plan or extra prompt would expose a side that is `attached_building`, for example "show the side facade", "remove the neighbour", "corner view", in vi and en
  - `OCCLUDED_TARGET`: WARN from the visibility resolver
  - `LOCKED_LIGHTING_CONFLICT`: BLOCK when the extra prompt asks for night or dusk while `locks.lighting` holds a daytime preset
- The other codes are registered but have no rules yet; they belong to P2–P5.
- A WARN may be accepted as an exception, stored per shot in the generation request snapshot. A BLOCK can only be cleared by editing the project data.
- **Gate:** the desktop UI runs `validateShot` before every paid generation submit, including batches and anchors. BLOCK disables submit and shows the reason with a "Sửa lựa chọn" action. The Rust backend re-checks only what it can cheaply: the snapshot carries the verdict, and a BLOCK snapshot is refused.

**Prompt versioning**
- `PromptBundle` gains:
  - `catalogVersion`
  - `validatorVersion`
  - `sourceHash`: sha256 of the canonical JSON of the DNA plus the shot intent
  - `configHash`: sha256 of the canonical JSON of the compiler options
  - `resolvedWarnings: string[]` (codes)
- Byte-identical output for identical input stays tested (AC-21).
- The extra prompt is validated before it is appended (AC-22).

**P1 — catalog and context**

**Space Catalog** (`packages/domain/src/spaceCatalog/`)
- Schemas for `BuildingArchetype` and `SpacePreset`:
  - `id`, `buildingArchetypes[]`, `zone`: `interior | exterior | semi_outdoor`
  - `category`, `spaceType`, `labelVi`, `labelEn`, `variants[]`
  - `requiredIfVerified[]`, `optional[]`, `forbiddenUnlessConfirmed[]`
  - `cameraIntentIds[]`, `objectCategoryRules?`, `promptTemplateId`
  - `scopeEn`: a curated English scope sentence
- A registry with lookup by archetype, plus a resolver: `spacesFor(archetype)`, `resolveActiveSpace(dna)`, `spaceScopeLines(dna)`.
- `CATALOG_VERSION = "sc-3.0.0-starter"`.
- Starter data (`knowledge/space-catalog/catalog.json`):
  - all 12 SRS archetypes, with labels
  - curated presets for townhouse, villa and apartment covering the SRS examples (living + kitchen, narrow rear courtyard, light well, rooftop terrace, garage, villa lobby, master suite, large garden, pool, apartment studio, loggia)
  - at least one preset per other archetype
  - English labels are real English, never unaccented Vietnamese
- `buildingArchetype` is independent of `ProjectTypeSchema`. A mapping table suggests the default archetype from the project type, and the project type is never changed.

**Compiler**
- Adds the sections `SPACE SCOPE` (only the active space, with its required, optional and forbidden lines) and `SITE & OCCLUSION`, which replaces the ADR-028 party-wall wording with resolver output.
- `COMPILER_VERSION` becomes `pc-1.7.0`.
- The interior default pack values (5 × 6 × 3 m, apartment) are labelled "sample — not verified" and no longer compiled as facts.

**Site adjacency and visibility** (`packages/domain/src/site/`)
- `resolveSiteAdjacency(dna)` as described above.
- `resolveVisibility(adjacency, camera) → { visibleFacades, occludedFacades, warnings, confidence, feasibleCameraZones }`
  - Facades: front, left, right, rear, roof.
  - An attached side is never visible.
  - A side counts as visible only when it is `street` or `open_space` and the camera azimuth reveals it.
  - Confidence is lowered when sides are `unknown` or evidence is not confirmed.
  - The resolver never claims exact visibility without heights or setbacks.
- `describeCamera` must not promise a side facade that the resolver marks occluded.
- Prompt core text follows SRS §5.2.

**UI (P1)**
- **Space selector wizard:** archetype → floor → group → space → variant, with an "other / custom" option and evidence badges (Đã xác minh / Chưa rõ / Theo ảnh tham chiếu). Unmeasured dimensions stay blank. It sets `activeSpaceId`.
- **Site adjacency editor:** four sides, each with kind and evidence, using the viewer-facing convention and a small plan diagram. It replaces the ADR-028 toggles but writes both representations.
- **Validator panel:** "Kiểm tra ràng buộc" with BLOCK, WARN and ALLOW, plus WARN exception approval.

**Out of scope here:** P2–P6 (simple camera, detail planner, effects, objects, enhance and upscale, diagram, publishing).

**Acceptance for this ADR:** AC-01, AC-02 (no bedroom furniture leaks into a garden scope), AC-03, AC-04, AC-20, AC-21, AC-22, plus the SRS §5.4 camera tests that apply without P2.

**ADR-034 amendment (2026-10-15).** The user supplied `Building_Space_Catalog_V3.zip` (256 presets) and `Architectural_Context_Library_V4.zip` (131 presets, 12 regions) in the AI handoff package.
- P1 imports V3 through a converter instead of the starter set.
- The 104 records whose `labelEn` and `englishPrompt` use unaccented Vietnamese are curated first.
- Context Library V4 becomes a suggestion layer that sits below site evidence.
- The full gap analysis and ordering are in `docs/plans/SRS_V7_2_UPGRADE_PLAN.md`.

**ADR-034 amendment 2 (2026-10-15): catalog scope.** The user narrowed the catalog: public and specialist interiors are out of scope, and only hotel and resort are kept among the non-residential types.
- In scope:
  - residential: `townhouse` (35 presets), `villa` (44), `apartment` (27)
  - hospitality: `hotel` (24), `resort` (22)
  - total: 152 of the 256 V3 presets
- Out of scope:
  - `healthcare`, `education`, `public`
  - `office`, `retail`, `cafe`, `restaurant`
- How the converter applies this:
  - It imports through an archetype allowlist; out-of-scope records are skipped, not stored.
  - Re-adding a type later is a one-line allowlist change plus curation of its records.
- Effects on P1a:
  - Curation of unaccented English labels and prompts covers only the in-scope records.
  - The wizard offers only the five archetypes.
  - The "cần chuyên gia duyệt" badge for specialist rooms is dropped, because no specialist rooms remain.
- `ProjectTypeSchema` is unchanged. A project type with no in-scope archetype gets no default archetype suggestion, and the space selector stays optional for it.

**ADR-034 amendment 3 (2026-10-16): gate follow-ups (SRS debts 1).**
- `PromptBundle.resolvedWarnings` holds only the WARN codes the user accepted. The compiler emits `[]`; the desktop gate's `withValidation` sets the accepted codes and replaces any older list. Codes that were found stay in `validation.issueCodes`. Prompt text is unchanged, so `pc-1.8.0` and `cv-1.2.0` stay.
- Every retry re-runs `validateShot` on the stored snapshot against the current DNA, with the shot intent the snapshot was compiled with. WARN codes accepted for the original submit stay accepted; a new WARN asks again in a retry dialog, and a BLOCK is refused. `job_retry` takes the fresh verdict as `validation`; Rust replaces the stored verdict with it and refuses BLOCK, as for a new submit. The free text appended to a stored prompt cannot be separated from it, so it is not re-checked on retry.
- The batch gate validates each item with the shot intent in its own prompt snapshot. ContactSheet re-run, mood variations and enhance batches show the same exception panel as the generate and batch dialogs.

**ADR-034 amendment 4 (2026-10-16): space, site and camera follow-ups (SRS debts 2).**
- The space wizard gains the optional floor step (building type → floor → group → space → variant). `SpaceInstance.floorId` holds a stable id (`basement`, `floor_1` … `floor_N` from `building.floors`, default 5, and `roof`). Changing the floor moves the active space; skipping it leaves `floorId` absent. The floor is not compiled.
- `lockedElementIds` is edited as chips over `LOCKABLE_SPACE_ELEMENTS` (walls, columns, stairs, doors and windows; flooring, ceiling and built-in furniture for interiors; paving, boundary walls and trees outside) plus the preset's optional items, and as free ids. SPACE SCOPE adds one "Locked elements, kept exactly where and as they appear in the approved references …" line when the list is not empty.
- The fact editor records the placement facts the scene-object rules read (`driveway`, `hardscape` for a villa yard; `garage_bay` for a garage) with an evidence badge (verified, user_declared, unknown). Ticking a fact declares it (`user_declared`); unticking removes it. The dimension badge offers the same three statuses.
- For an interior project, the active catalog space suggests its ADR-027 room (`suggestInteriorRoom`); one click writes `interior.roomId`, and the interior panel stays the owner. An exterior or semi-outdoor active space drops the "Interior space: …" form line, as it already dropped the furnishing line.
- The site editor edits `heightRelation` for attached neighbours and boundary walls.
- The negative prompt, the camera section, SITE & OCCLUSION and the camera chips read the camera plan through `siteCameraPlan`, which folds `resolveSiteAdjacency` back to the ADR-028 toggle vocabulary. A DNA without `site`, or with a `site` that mirrors the toggles, compiles byte-identically; an explicit `site` that disagrees with the toggles now wins.
- `COMPILER_VERSION` becomes `pc-1.9.0`. The validator version is unchanged.

## ADR-035 — SRS P3: enhance preservation modes with local checks, upscale size targets

Status: accepted (2026-10-16). Basis: SRS §8–§9 (modules E and F), the upgrade plan §5 P3, and the user's decision of 2026-10-15 to use local checks only, with no Vision QC (ADR-033).

**Enhance preservation modes**
- `EnhanceParams` gains an optional `preservationMode` with three values:
  - `strict`: local and non-generative only (provider `local_upscale` plus deterministic tone, denoise and sharpen). No AI call.
  - `balanced`: AI edit inside the allowed region only. Locked regions are composited back from the source pixels.
  - `creative`: stronger AI edit inside the allowed region. Review is always required.
- Mapping from the existing fields:
  - Old params without `preservationMode` keep their current behaviour.
  - `conservative` maps to `strict` and `generative` maps to `balanced`, but only when the UI shows the new selector.
- Locks: `geometry`, `material`, `context` and `camera`. They are booleans, all on by default.
  - The generative prompt follows the SRS §8.2 template.
  - The camera lock forbids any crop or aspect-ratio change.
- Allowed region:
  - It reuses the existing region masks (`regions/mask.rs`).
  - When no mask is set in `balanced` or `creative` mode, the whole frame is allowed, but every lock still applies to the prompt, and the result is marked "review required".

**Local checks** (`EnhanceCheck`; free, deterministic, run in Rust after the provider returns)
- The output size matches the requested target and the aspect ratio is kept.
- Registration: a global offset estimate on downscaled luminance. A shift above the threshold is a warning.
- SSIM on locked regions after compositing. It must be at least 0.98 in locked pixels, otherwise a warning.
- In `strict` mode, an edge-structure check confirms that no new structure was introduced.
- The result is stored as JSON on the generation (a new optional column or the existing metadata JSON). It is shown as a pass/warn badge with reasons.
- These are checks, not a score. They never block saving; a warning asks for review.
- The QC tables from ADR-024 stay untouched and unused.

**Upscale targets**
- Optional `upscale`:
  - `target`: `long_edge_2048 | long_edge_4096 | uhd_3840x2160_contain | custom{width,height,fit:"contain"}`
  - `ifAlreadyLarger`: `keep | quality_only | skip`
- Aspect ratio is always kept. UHD is contain or letterbox only, never a crop. Nothing is ever downscaled unintentionally.
- `UpscaleProviderCapabilities`: `maxPixels`, `supportsTiling`, `imageToImage`, `privacyClass`, `costEstimate | null`.
  - A null cost shows "Chưa xác định chi phí".
  - A batch with a known cost needs confirmation before any paid submit.
- Batch behaviour is unchanged: one job per item, a failed item does not stop the others, and retry resends only the failed items with no duplicate charge.

**Provenance:** every enhanced asset records `parentAssetId`, `inputHash`, `configHash`, provider/model, `preservationMode` and the `EnhanceCheck` id.

**Out of scope:** ComfyUI and remote GPU providers (P6), LPIPS, and Vision QC.

## ADR-036 — SRS P2: visual camera intent, detail shots, effects, scene objects

Status: accepted (2026-10-16). Basis: SRS §5.1 and §5.3–§5.4 (module B), §6 (module C), §7 (module D), AC-05 to AC-09, and the conflict-avoidance rules in §3 of the upgrade plan.

**Shared rules**
- Per-shot choices live in a **ShotIntent snapshot**. They are never written into the DNA. These choices are:
  - the visual intent
  - `targetDetailId` / `detailShotCount`
  - `effects`
  - `sceneObjects`
- `ShotIntent` (from `packages/domain/src/validation`) gains these fields as optional members, and a schema is added for it.
- The desktop keeps the current ShotIntent per project in the workspace store. The generation request snapshot stores it in `PromptBundle.shotIntent`, an optional field that is also mirrored in the Rust DTO.
- Every module registers its rules in the single validator, using the SRS §12.4 codes, and contributes one compiler section in `prompt/sections/<name>.ts`.
- When a P2 module emits a section, `COMPILER_VERSION` becomes `pc-1.8.0` and `VALIDATOR_VERSION` becomes `cv-1.2.0`. The lead resolves the version conflicts at merge.
- Absent choices change nothing: the prompt stays byte-identical apart from the version strings.

**P2a — visual camera intent** (`camera/intent.ts`, `features/camera/VisualIntentSelector.tsx`)
- A simple mode asks "Bạn muốn nhìn gì?", with the choices:
  - front
  - oblique from the street
  - pedestrian eye level
  - overview
  - approach
  - detail
  - aerial, only where it makes sense
- It then asks "Ảnh dùng để làm gì?": landscape, portrait or square.
- `resolveVisualIntent` turns the answers into suggested `CameraDNA` fields. It never invents measured distances.
- A custom mode offers near/far, high/low and wide/focused sliders. The expert mode is the existing `CameraDirector`.
- Switching between the Simple and Expert modes keeps the original camera data.
- Presets that make no sense for the space are hidden. For example, a bedroom never offers a drone or roof view.

**P2b — architectural details** (`detail/`)
- `ArchitecturalDetailRegistry` works over `dna.architecturalDetails` (P0 schema) and is its only writer.
- `DetailShotPlanner(dna, count 1–10)`:
  - picks verified details;
  - spreads distinct cameras that the visibility resolver says can see the target;
  - never invents details: with 5 shots and 3 details it plans more angles of the 3 or reports a shortfall (AC-05);
  - a target the camera cannot see raises `OCCLUDED_TARGET`.
- Compiler section `DETAIL TARGET`, following the SRS §5.3 example.
- UI: "Khám phá chi tiết", which lists the confirmed details and the shot count, plus a detail editor.

**P2c — optical and motion effects** (`effects/`)
- A catalog of the six SRS effects, each with an intensity of light, medium or strong. All are off by default, and a shot has one primary effect.
- `EffectsCompatibilityMatrix` returns `available | conditional | blocked` with a plain reason. It checks the space zone, the site, the camera, the weather and lighting, and the scene objects.
- Codes:
  - `EFFECT_SOURCE_MISSING`: for example clouds or sky in a closed interior (AC-09), or a sunstar without a light source.
  - `EFFECT_MOTION_CONFLICT`: for example light trails while the only vehicle is parked (AC-08).
- Compiler section `EFFECTS`, following the SRS §6.2 example.
- It reads scene objects only through the P2d schema, so it starts after P2d is merged.

**P2d — scene objects and car library** (`sceneObjects/`)
- Object types: person, car, motorbike, bicycle, plant, pet.
- Car presets, starting with:
  - Mercedes-Benz 300 SL Gullwing coupe
  - Shelby/AC Cobra 289 (1964)
  - Jaguar E-Type Series 1 coupe and roadster
  - generic groups: modern sedan, SUV, EV, Vietnamese city car, motorbike, bicycle
- Cars are labelled "mô phỏng theo mẫu xe".
- `SceneObjectRequest`: `presetId`, `quantity`, `targetSpaceId`, `placementZoneId`, `state` (static or moving), `appearanceOverrides`, `visibility`, `sourceReferenceIds`.
- `ObjectPlacementValidator`:
  - uses a per-space allowed table built from the space catalog zone and category, following the SRS §7.1 table;
  - raises `OBJECT_NOT_ALLOWED_IN_SPACE` (BLOCK), for example a car in a bedroom (AC-06);
  - raises `OBJECT_NO_PLACEMENT_ZONE` when there is no verified driveway or garage. A verified garage with a 300 SL is allowed (AC-07);
  - never creates a driveway.
- With no objects selected, nothing new is added.
- Compiler section `SCENE OBJECTS`, following the SRS §7.2 example.
- It owns `dna.scene` only for project-level object defaults, if any exist; per-shot objects live in ShotIntent.

**ADR-036 amendment (2026-10-16): SRS debts 1.**
- The per-project ShotIntent survives restarts. It is kept in `localStorage` under `arch.shotIntent.<projectId>`, never in the DNA, and a stored value that fails `ShotIntentSchema` is dropped on load.
- "Khám phá chi tiết" queues one item per planned shot (`buildDetailBatchItems`). Each item compiles with its own ShotIntent: the shot's `targetDetailId`, its camera and the shot count. Two details seen by the same camera are therefore two items.

**ADR-036 amendment 2 (2026-10-16): interior camera intents (SRS debts 2).**
- A shot is an interior one when the active space's zone is `interior`; without an active space, when `dna.interior` exists (`isInteriorShot`). An interior project whose active space is a garden offers the aerial view again.
- For interior shots, `overview` and `approach` suggest `interior_wide` and `detail` suggests `interior_detail`, with the ADR-027 interior camera preset wording ("wide view from the entrance showing the whole room", "one-point perspective facing the main wall", "close-up material and furniture detail"). They never suggest `exterior_front`. The other views keep their suggestions.

## ADR-037 — SRS P4: Diagram Studio (MVP)

Status: accepted (2026-10-16). Basis: SRS §10, AC-14 and AC-15.

**Domain** (`packages/domain/src/diagram/`)
- Diagram types: `concept_evolution`, `massing_voids`, `functional_zoning`, `circulation`, `sun_ventilation`, `facade_material`.
- `DiagramStep`:
  - `id`, `index`, `title { vi, en }`, `caption { vi, en }`
  - `evidence`: `verified | inferred | illustrative`
  - `annotations[]`: labels and arrows in normalized coordinates
  - `frameAssetId?`
- `planDiagram(dna, type, stepCount 4|6|8|custom)` builds steps from the DNA facts.
  - Townhouses favour light well, depth, party walls and per-floor organisation. Villas favour massing split, approach, garden and indoor–outdoor.
  - It is not the same Site → Extrude → Subtract sequence for every building.
  - A step without verified facts gets `illustrative` and the label "sơ đồ diễn giải ý tưởng".
  - Interior functions are never stated as verified without a plan or evidence (AC-14).
- `layoutDiagramSheet(steps, layout: 2x2|2x3|2x4|linear, lang)` returns an SVG string.
  - All text, arrows and labels are vector, never drawn by an AI model.
  - Style, palette and frame geometry are fixed, so every panel matches (AC-15).
  - The output is deterministic.

**Frames**
- An optional isometric frame per step is a paid image generation, run through the existing generate flow, the conflict gate and the SRS §10.3 prompt.
- All steps use one fixed isometric camera preset and are submitted as one batch.
- Without frames, the sheet uses the source render plus the vector overlay.

**Export**
- PNG 2K/4K: rasterize the SVG in the webview and save through the existing asset import path.
- MP4: built only after the steps are approved, with FFmpeg from the static frames (pan, zoom and appear).
  - FFmpeg is detected on PATH. When it is missing, the video export is disabled with a message; it is never bundled.
- The module flag in `features/workspace/modules.ts` stays off until the UI is complete.

## ADR-038 — SRS P5: Publishing Studio (MVP)

Status: accepted (2026-10-16). Basis: SRS §11, AC-16 to AC-19.

**Domain** (`packages/domain/src/publishing/`)
- Publication types: `portfolio`, `catalog`, `concept_book`, `magazine`.
- Sixteen styles, four per type, as named in SRS §11.2. Each style has:
  - a palette
  - font families and a type scale
  - spacing and margins
  - divider, caption and cover rules
- Layout templates:
  - hero full page
  - hero plus secondary images
  - 2×2, 2×3 and flexible grids
  - split
  - asymmetric editorial
  - diagram sheet
  - dense contact (one main frame plus grouped thumbnails)
- `planPublication(input)`:
  - **Input fields:**
    - `selectedImageIds`
    - `targetPageCount ≥ 1`
    - `selectionMode`: `include_all | ai_select`
    - `type`, `paper` (`A4 | A3 | 16:9`), `textDensity`, `styleId`, `layoutMode`
    - `seed`, `lockedPageIds`
  - **Page count:** returns exactly `targetPageCount` pages, without exception.
  - **`include_all`:** places every selected image exactly once, unless repeating is enabled.
  - **`ai_select`:** chooses a subset, records the reasons, and still keeps the exact page count.
  - **More pages than images:** the extra pages are valid text, cover or diagram pages. Images are never invented.
  - **Layout choice:** layouts differ by type. For example, 10 images on 1 page give a Concept layout grouped by context, massing, space and detail, while a Portfolio uses a hero layout (AC-16, AC-17).
- **Randomising:** the whole-book style, the per-page layout, or smart random.
  - Same seed → same result.
  - Locked pages never change (AC-18).
  - Content and facts are never reshuffled.
- `ContentFitValidator`, codes:
  - `PRINT_READABILITY_LOW` (WARN): effective PPI from the asset size and the printed slot size, minimum font size, overflow, safe crop.
  - `PAGE_COUNT_MISMATCH`
  - `REQUIRED_IMAGE_MISSING`
- **Captions:**
  - Every caption slot has `textKind: technical | editorial | commercial`.
  - Every sentence that states a number, place, year, award, brand or author needs a `factRef`; without one it is `needs_review`.
  - `UNVERIFIED_PUBLICATION_FACT` (BLOCK) prevents exporting unreviewed claims as facts (AC-19).
  - AI-written captions, an optional paid text call, use the SRS §11.4 prompt and go through the same rule.
- Publications pin images by `assetId` plus `sourceHash`, so a later render never changes an old publication.

**Storage**
- A Rust migration adds a `publications` table: `id`, `project_id`, `json`, `created_at`, `updated_at`.
- Commands `publication_list`, `publication_get`, `publication_save` and `publication_delete` follow the `blocking()` pattern and are mirrored in contract fixtures.

**Export (MVP)**
- PNG/JPEG per page, rendered in the webview.
- PDF: page images in a minimal pure-TS PDF writer that embeds JPEG (DCTDecode) at the paper size. Text is rasterised in this MVP.
- No new npm or cargo dependency unless it is already in a lockfile.
- Vector-text PDF, bleed, brand kit, flipbook and video are P6.

## ADR-039 — M1: shot presets as the main way to build a shot; quick generate

Status: accepted (2026-10-19). Basis: the user's VizMaker study and plan `docs/plans/VIZMAKER_IMAGE_PLAN.md` (image phase first; video, 3D, accounts later).

**Why.** Users currently walk through nine modules and five DNA confirmations before one image. The goal is the VizMaker-style flow: source image → click presets → Generate, while keeping DNA, the validator and lineage as the source of truth.

**Domain** (`packages/domain/src/presets/`, done in this ADR)
- `ShotPreset`: `id`, `group` (render, time_light, weather, camera, people_cars, effects, color_look), optional `exclusive` key, `scope` (exterior / interior / any), bilingual label and hint, structured `patch`, optional `promptEn` + `keepEn`, and `source`.
- Catalog `SHOT_PRESETS` (`ps-1.0.0`, 47 presets). Structured parts reuse the existing catalogs: times of day, visual intents, `EFFECT_CATALOG`, `SCENE_OBJECT_PRESETS`, `GRADE_LOOK_CATALOG`. All sentences are the app's own; nothing is copied from VizMaker (its terms forbid extracting prompts or `.vm` files). The catalog stays in TS like the other catalogs, so a wording change is a reviewed, versioned diff.
- `ShotIntent` gains `presetIds`, `lighting { timeOfDay, weather }` (this shot only) and `gradeLookId` (free post-production look, never compiled). Rust already passes unknown ShotIntent keys through (`#[serde(flatten)] extra`).
- `setShotPresets(shot, ids, dna)` materialises a selection: it removes the previous selection's contribution, then applies the new one, so chips are reversible and the Advanced panels keep editing the same fields. Objects go to `SITE_FRONTAGE_TARGET` outdoors or the active space indoors; presets that do not fit are returned as `skipped`. `togglePreset` handles dedupe and exclusive replacement.
- **Compiler `pc-1.10.0`:**
  - `shotIntent.lighting` replaces the DNA time of day and weather in the LIGHTING and WEATHER sections. The time-bound sun fields and the lighting preset id are dropped. Interior DNA maps dawn to morning and blue hour to evening.
  - A locked section is never overridden.
  - New `PRESETS` section after EFFECTS: one line per preset sentence. A camera preset adds a viewpoint line only when no DNA camera is compiled.
  - `metadata.presetSources` and `presetCatalogVersion` are present only when such a line exists. `configHash` includes the catalog version only then, so prompts without presets are byte-identical apart from the version string.
- **Validator `cv-1.3.0`:**
  - `LOCKED_LIGHTING_CONFLICT` also fires when a shot time differs from the locked lighting.
  - New `LOCKED_WEATHER_CONFLICT` (BLOCK) for a weather preset against locked weather.

**Desktop (M1 A2–A6, done)**
- **A2 Preset grid.**
  - `features/presets/PresetGrid.tsx` shows the presets of `presetsForShot` by group, plus a selected-chip row with ×. The colour-look chip is marked as free and applied after generating.
  - A click runs `togglePreset`, then `setShotPresets`, then `setShotIntent`. Presets that do not fit the shot are listed.
  - The Prompt Preview names the presets behind the PRESETS lines (`metadata.presetSources`).
- **A3.** Visual intent, provider, output, references, anchors and batches move under the panel's Advanced mode. The Effects and Scene objects modules stay; chips and these panels edit the same ShotIntent fields.
- **A4 Quick generate.**
  - `WorkflowFacts.hasSourceImage`, and in Rust `ensure_generation_allowed(…, has_source_image)`: a hero whose references include a `structure_sketch` or `master_architecture` asset skips the DNA steps.
  - Anchor, production and master-based purposes keep their gates.
  - Rust derives the flag from the reference rows at validation and again when queueing. The mock backend mirrors it.
- **A5 Generate panel.**
  - A Simple / Advanced switch, remembered in `localStorage["arch.generateMode"]`. Simple is the default.
  - **Simple:** Source → Presets → extra prompt → conflicts → Generate with the cost estimate.
  - **Advanced:** adds the stepper, anchors/batches, visual intent, provider, output and references.
- **A6 Navigation.**
  - `ModuleGroup` = studio, dna, shot, post, export.
  - Order: Overview and Generate, then the DNA steps (Design DNA, Context, References, Camera, Lighting, Detail), Scene objects and Effects, post-production, and publishing. Every group has a label.
  - This deliberately changes the "do not reorder" navigation; module ids and DNA step numbers are unchanged.


## ADR-040 — M2: My presets, SketchUp inbox, custom OpenAI-compatible gateway

Status: accepted (2026-10-20). Basis: `docs/plans/VIZMAKER_IMAGE_PLAN.md` M2. The user asked for all three parts, with the gateway kept generic (no BEAR-specific details are known), and for My presets to be shared by every project.

**My presets**
- Migration `0010_user_presets.sql`: `user_presets(id UPR_…, name, preset_ids JSON, created_at, updated_at)`. App-wide, with no project foreign key.
- `services/user_presets.rs` has `list`, `save` (create, or update by id) and `delete`.
  - **Validation:** the name is trimmed and 1–60 characters; 1–24 unique ids, each matching `[a-z0-9._]{1,64}`.
  - **Catalog:** the backend does not know the catalog. Unknown ids are skipped by `normalizePresetIds` when a combination is applied, so renaming a preset never breaks a saved row.
- **Commands:** `user_preset_list`, `user_preset_save`, `user_preset_delete`.
- **UI:** a "My presets" row in `PresetGrid`.
  - Clicking a combination replaces the selection.
  - "Save current combination" names the current chips.
  - Delete always goes through `ConfirmDialog`.

**SketchUp inbox**
- **Folder:** `<data-root>/inbox/sketchup/`, holding `<name>.png` and an optional `<name>.json` with `{ version, model, scene, width, height, capturedAt }`.
- **Listing:** `services/sketchup_inbox.rs::list` returns the waiting views, newest first. A broken sidecar only hides the details.
- **Import:** `import(projectId, fileNames)`.
  - **File names:** only plain PNG names inside the inbox are accepted; paths and traversal are refused.
  - **Asset:** each view goes through `assets::import` with source `sketchup` and role `structure_sketch`.
  - **Duplicates:** a `DUPLICATE_ASSET` returns the existing asset (`details.existingAssetId`) and is counted in `duplicates`.
  - **Afterwards:** the pair moves to `imported/` (renamed ` (2)` on a clash). Nothing is deleted, and no model runs.
- **Asset protocol:** the inbox folder is added to the asset-protocol scope so the UI can show thumbnails.
- **UI:** "Receive from SketchUp (N)" under the Generate source. An imported view is selected as the sketch source of a hero shot, which allows quick generate (ADR-039).
- **Extension** (`tools/sketchup/arch_studio_bridge*`):
  - menu items: Send current view, Send all scenes (transitions off while exporting), Open inbox folder;
  - the PNG is rendered in `.partial/`, the sidecar is written, then the PNG is moved in, so the app never lists half-written files;
  - the data folder is `ARCH_STUDIO_DATA_DIR`, else the Tauri app-data folder of `com.archaistudio.desktop`;
  - `npm run sketchup:rbz` builds the `.rbz` with a dependency-free ZIP writer.

**Custom gateway**
- `providers/gateway_env.rs::config_from_env(spec, env)` is the shared environment parser. HHTECH now uses it with its catalog and default chat model, and its existing tests are unchanged. `HHTECH_ASSIST_MODEL` is still validated in `hhtech::config`.
- **Provider** `providers/gateway`: id `gateway`, configured only from `GATEWAY_*`.
  - **Required:** `GATEWAY_BASE_URL` and `GATEWAY_IMAGE_MODEL` (plain entries, no tiers or prices).
  - **Optional:** `GATEWAY_CHAT_MODEL`; without it, Enhance prompt is not offered.
  - **Key:** from the keychain under `gateway`, or `GATEWAY_API_KEY`.
  - Until it is configured, it is listed with no models and never called.
- **`ProviderDescriptorDTO.models`:** may now be empty. The UI already falls back to `null` when no model exists.


## ADR-041 — M3: branch canvas derived from lineage

Status: accepted (2026-10-20). Basis: `docs/plans/VIZMAKER_IMAGE_PLAN.md` M3 (A8 + A9).

**Decision.** The node canvas is a view of data that already exists, not a second store of runs. Every generation records its `referenceAssetIds`, `parentAssetId`, `outputAssetIds` and `prompt.shotIntent.presetIds`. The domain `buildBranchGraph` turns them into image → generation → image nodes:
- the result is pure and deterministic;
- it is acyclic by construction, because a generation's depth is greater than that of its references.

Runs stay the immutable generation records they already are. The planned `recipe_graphs` / `recipe_runs` tables are therefore not needed.

**Graph and layout**
- **Image nodes:** every asset a generation used or produced, plus standalone `structure_sketch` and `master_architecture` sources.
- **Generation nodes:** status, purpose, provider/model and preset labels.
- **Edges:** reference → generation (dashed unless it is the lineage parent), and generation → output.
- **Draft node:** dashed, after the source the Generate panel would use, showing the current presets. It has no run button, because every run still goes through the Generate panel and its spend confirm.
- **Layout:** `layoutBranchGraph` places nodes in depth columns. Dragged positions are stored per project in migration `0011_canvas_layouts` (`{ version: 1, positions }`, at most 512 KB) through `canvas_layout_get` and `canvas_layout_save`; a row that no longer parses reads as empty. Re-arrange clears the stored positions.

**UI.** "Branches" is a centre tab of the Generate module, so the right panel stays the Generate panel.
- **Image nodes:** "Use as source" makes the image the hero source; "View large" opens it in the image tab.
- **Generation nodes:** "Reuse presets" (`setShotPresets` with that run's ids), "Copy prompt", and "Retry" for failed or cancelled runs, behind the usual spend confirm.
- **Compare:** Shift-select two images, then "Compare A/B" opens the existing `CompareCanvas`.

**Quick generate from outputs.** `is_source_image(role, source)` in Rust, and `isQuickSourceImage` in the domain and mock, also accept `ai_generated` images of the project. This lets a branch continue from an output without confirmed DNA. To guard against drift, `aiDepth` counts AI images in a row on the primary lineage; from `AI_CHAIN_WARNING_DEPTH` (3) the node shows a warning to go back to the original source.

**Dependency.** `@xyflow/react` 12.12.0 (React Flow, MIT) provides pan, zoom, drag and selection. It is the only new dependency, pinned exactly.


## ADR-042 — M4: image recipes and the evidence analysis board

Status: accepted (2026-10-20). Basis: `docs/plans/VIZMAKER_IMAGE_PLAN.md` M4 (A10 + A11).

**Recipes** (`packages/domain/src/recipes/`)
- A recipe is a list of variants, and each variant is a list of preset ids. `planRecipe(recipe, baseShot, dna, variantIds?)` puts each variant on top of the user's current chips through `setShotPresets`, so the variant wins every exclusive key (time, weather, palette…) and the other chips stay.
- A variant whose own presets do not fit the shot is left out; for example, facade colours are dropped for an interior shot.
- **Built-in recipes:**
  - 6 lighting scenarios (morning, midday, golden hour, overcast, blue hour, night);
  - weather set (4);
  - facade colour options (4);
  - material moodboard (1).
- **New presets** (catalog `ps-1.1.0`): a `palette` group with five wall colours (exterior only). The sentence changes only painted wall surfaces and keeps every other material. `render.material_moodboard` creates a flat-lay board of the materials visible in the source, with no text.
- **Running:**
  - The Generate panel lists the variants with checkboxes.
  - One spend confirm covers the total (variants × images per run), then each variant is submitted as an ordinary generation with its own shot intent.
  - Every run stays an immutable record with lineage and appears on the branch canvas; nothing runs on the recipe's own.

**Evidence analysis board** (`packages/domain/src/analysis/`)
- One vision call through the existing DNA-assist path. Rust `dna_assist` accepts the new scope `analysis` (mode `images`); the call uses the HHTECH assist model and is recorded as an `assist` generation.
- **Model output:** `ANALYSIS_SYSTEM_PROMPT` (the app's own wording) asks for strict JSON describing only what is visible: materials with a visibility confidence, up to 6 hex colours, composition, and up to 5 observations. Dimensions, prices, brands, standards and performance claims are forbidden. The instructions stay in English; the findings are written in the UI language (`analysisSystemPrompt`), because they are shown to the user, not sent to a model.
- **Parsing:** `parseImageAnalysis` accepts a ```json fence and validates against `ImageAnalysisSchema`.
- **Drawing:** `analysisBoardSvg` draws the board itself (escaped, deterministic, image on the left), so the text is sharp and no number is painted by the model. Every board says "inferred from the image by AI — not measured", and the confidence words describe visibility, not quality.
- **UI:** "Analyse image" on an image node of the branch canvas.
  - "Analyse" runs only on click.
  - "Save as image" rasterises the board (2400 px) through `diagram_image_save`, as a new asset derived from the analysed image.


## ADR-043 — B1: image to video (Kling, Veo, Seedance, Comfy Cloud)

Status: accepted (2026-10-20). Basis: phase B of `docs/plans/VIZMAKER_IMAGE_PLAN.md`; the user asked for key slots for Kling, Veo and Seedance (keys entered later) plus Comfy Cloud.

**Decision.** A video is one more purpose (`video`) of the existing generation pipeline, not a parallel system. It reuses `generation_submit`, the persistent job queue, history, versions and lineage. Only the attempt differs: video providers implement `VideoApi` (`submit` → `poll` → `download`) instead of `ImageProvider::generate`. `VideoProvider` wraps each adapter and still implements `ImageProvider`, so the registry, key store, provider list and queue slots work unchanged. It reports `OutputKind::Video` (`outputKind` on the provider descriptor) and refuses image requests.

**Billing safety**
- Right after a provider accepts a clip, its task is written to `video_tasks` (migration `0012`, additive). Every later attempt resumes polling the stored task instead of submitting again: the queue's own network retry, the user's Retry (the row moves to the new generation) and an app restart (startup recovery requeues a running video job instead of interrupting it). One request is billed once.
- The row is removed when the clip is stored or when the provider reports a failure. A failed clip can then only be made again as a new request, behind a new spend confirm.
- `auto_retries_timeouts` is false for every video provider. After 30 minutes of polling the attempt fails with a retryable `timeout`, and the task row is kept, so Retry keeps waiting.
- Cancel only stops the app from waiting; the UI says the provider may still bill.
- The spend confirm always opens for a paid clip; the "do not ask below N đ" threshold does not apply to video. The free local mock preview skips it, as local providers always do.

**Adapters** (`providers/video/`). All take their models from `*_VIDEO_MODEL` (comma-separated ids, a default otherwise) and a base URL from `*_BASE_URL` (https only; http only for loopback). Keys come from the OS keychain or the environment.
- **Kling:** `POST /v1/videos/image2video` with the first frame as raw base64, then `GET …/{task_id}`. The key is `ACCESS_KEY:SECRET_KEY`; each call carries an HS256 JWT signed in-process (`iss`, `exp` +30 min, `nbf` −5 s; HMAC-SHA256 tested against RFC 4231). Clips are 5 or 10 s, and the ratio follows the image.
- **Veo (Gemini API):** `POST /v1beta/models/{model}:predictLongRunning`, then `GET /v1beta/{operation}`, with the key in `x-goog-api-key` (a Gemini key works). Clips are 4, 6 or 8 s at 16:9 or 9:16. RAI-filtered results are reported as `blocked`.
- **Seedance (BytePlus ModelArk):** `POST /api/v3/contents/generations/tasks` with a text part and the first frame as a data URL, then `GET …/tasks/{id}`. Duration and ratio go as `--duration` / `--ratio` flags in the text. Seedance has no negative prompt, so the avoid list is appended as plain "Avoid: …" text.
- **Comfy Cloud:** runs a ComfyUI workflow the user exported with "Export (API)", named by `COMFY_VIDEO_WORKFLOW`. It uses `{{image}}` (required), `{{prompt}}`, `{{negative_prompt}}` and `{{duration}}`; a value that is exactly `"{{duration}}"` becomes a number. Calls: `POST /api/upload/image`, `POST /api/prompt`, `GET /api/history/{id}`, then `GET /api/view`, all with `X-API-Key`. Without the workflow file the provider is listed as not configured.
- **Downloads:** https (or loopback) only, at most 500 MB, and the bytes must carry an MP4, MOV or WebM signature. The key header goes to the vendor's URL only; a redirect is followed once without it, so a signed storage link never receives the key. Errors quote the vendor's message with the key redacted, including each part of a Kling `ACCESS:SECRET` key.
- **Sources:** the request shapes follow the vendors' public documentation as of 2026-10. The official pages could not be fetched from the build container, so some details come from third-party guides. Every response is therefore parsed defensively, and each adapter is tested only against a mock HTTP server. **No live call was made.**

**Video assets.** A clip is an `assets` row with a `video/*` mime type; no new column was added. `AssetDTO` derives `mediaKind` from the mime type and reads `durationMs` from the operation metadata (taken from the MP4 `mvhd` box, else the requested length).
- **Lineage:** `parent_asset_id` is the first frame's asset, and the version operation is `video`.
- **Thumbnail (poster):** the clip's first frame via FFmpeg when it is on PATH, else the source image.
- **Restrictions:** a clip is never a reference or the master (refused in `check_reference`, `update_role` and `set_master`).
- **Image modules:** they list only image providers and image assets.

**Domain** (`packages/domain/src/video/`)
- Eight motion presets in the app's own wording, each with a list of things to avoid.
- `compileVideoPrompt` (`vc-1.0.0`) is deterministic and does not write to the DNA. It produces a short prompt: a building summary from the DNA, the motion, an optional user note, the rigid-architecture preservation sentence, and the section sources in its metadata.
- Cost per clip comes from `priceHint["<n>s"]`. No video model has a price yet, so the UI says "no price known".

**UI.** A "Video" module in the Studio group.
- **Right panel:** source image, motion grid, provider/model, length, ratio, note, cost, then **Create video** through the spend confirm.
- **Centre:** a `<video>` player, plus the clip's first frame next to the source image so warping is easy to spot.
- **Tray and branch canvas:** clips get a ▶ badge with their length.
- **Playback:** the Tauri CSP gains `media-src` for the asset protocol.
- **Mock backend:** lists the four providers unconfigured, plus a free `local_video_preview` whose "clip" is the source image as a still poster.


## ADR-044 — V6.1-R1: responsive Studio shell, contextual selection and the large viewer

R2 follow-up (2026-10-20, direct owner request): graph selection also routes the active editing
module without flushing DNA or changing image/video drafts. Video draft choices are session state
and reset on project open. The viewer now uses the browser Fullscreen API when supported, pauses
workspace playback and restores its source after StrictMode cleanup. Be Vietnam Pro is bundled
under SIL OFL 1.1. Windows test and browser evidence: `docs/design/v6-1/QA_R2.md`.
The remaining text records the original R1 proposal and its limits at that time.

Status: proposed for review (2026-10-20). Basis: `UX_UI_V6_CLAUDE_SPEC.md` V6.1 and `ADDENDUM_RESPONSIVE_NODE_PREVIEW.md` (P0), supplied by the project owner. Branch `claude/ux-v6-1`, not merged into `main`.

**PR #2 (Premium Duotone UI).** Branch `feature/premium-duotone-preset-ui-20261020` (e1e94d6) was merged into the V6 branch, not into `main`. The only conflict was two imports in `ProjectWorkspace.tsx`; both were kept. Its viewport-based overrides were replaced by the tiers below: the `48vw`/`40vw` panel caps and the stacked grid under 700 px. PR #2 itself stays open. The uncommitted Typography V2 work on the owner's Windows machine was not available here and is not included.

**Responsive shell** (`features/workspace/layout.ts`, `styles/responsive.css`)
- **Measurement:** the workspace measures itself with a ResizeObserver in CSS px, never `window.innerWidth`. Maximize, restore, panel drags and Windows display scale all resolve the same way; 1920 px at 150 % is 1280 CSS px.
- **Tiers:** `data-tier` is wide (≥ 1600), regular (≥ 1280), compact (≥ 1000), narrow (≥ 800) or tight. `data-short` is set below 760 px of height.
  - **Nav:** icon-only from compact down; labels become accessible names and tooltips.
  - **Inspector:** below 1000 px it becomes a drawer, opened from the top bar or by choosing a module and closed with Esc. It stays mounted, so form state survives every resize.
  - **Inspector width:** the user's stored width is kept and only capped to what fits, so the canvas keeps 480 px. Double-clicking the handle resets it.
- **Tauri:** the minimum window size drops to 800×600, because 1920 px at 200 % is only 960 CSS px wide.

**One selection** (`features/selection/`)
- **`resolveSelection`:** turns Studio's selected asset, or Node mode's graph nodes, into one value: none, image (source / ai / import), video, reference, generation (pending / complete / failed), draft or multi. A clip is never an image.
- **Who reads it:** the toolbar, the inspector, the centre preview and the viewer all read this value.
- **Store:** `workspaceMode` (remembered per device), `canvasSelection`, a per-project `nodeViewport` (this session only, never in ProjectDNA) and `viewer`.

**Action registry** (`actions.ts`)
- **Shape:** one table of actions, each with applies, disabledReason, run and risk.
- **No new behaviour:** every action maps to a function that already exists. Read-only projects disable every change but keep viewing. Retry is the only paid action and goes through the existing spend confirm.
- **Clips:** only Play, Source image and New clip.
- **Compare:** needs exactly two images and gives the reason otherwise.

**Toolbar and inspector**
- **`ContextualToolbar`:** up to four buttons (three when compact), then a `…` menu.
  - **Node mode:** the toolbar floats above the selected node, or below it near the top edge, and is clamped inside the canvas (`placement.ts`). It follows pan, zoom and drags.
  - **Studio mode:** it sits top-right over the preview.
- **`SelectionInspector`:** heads the inspector with a breadcrumb, a thumbnail that opens the viewer, role/size/length, lineage, and the state and outputs of a run. Module panels stay mounted below it.
- **Studio | Node switch:** sits in the top bar and replaces the Branches tab. Publishing, Diagram and Region edit keep their own centre.
- **Node Canvas:**
  - The viewport is restored when the canvas mounts again, with no `fitView` jump.
  - Double-click opens the viewer.
  - Only visible nodes render once the graph has 100 or more.
  - Thumbnails load lazily.
  - Reference nodes carry a role badge, and running jobs show "no result yet".
  - Node objects keep the sizes React Flow measured, so a selection change no longer hides a node for one frame. That hiding was breaking double clicks.

**Large viewer** (`features/viewer/MediaViewer.tsx`)
- **Layer:** a portal layer over the app, z 35, below dialogs.
- **What it steps through:** the opener's set — one run's outputs, else one media kind of the project — with a "3 / 8" position, ← / → navigation, and stops at both ends.
- **Images:** Fit, 100 %, 25–400 %, `+ − 0 1` keys, wheel inside the viewer, and double-click to toggle Fit ↔ 100 %. Pan is clamped so 64 px always stay visible. An image can be compared with its lineage source; clips cannot.
- **Clips:** the browser's own controls (play, seek, volume, mute, fullscreen), plus Stop. No autoplay. Closing the viewer or moving on pauses and releases the media.
- **Keys and focus:** Esc closes and returns focus to the opener, and Tab stays inside. Keys stop at the viewer, so canvas or region shortcuts never fire behind it; the region canvas also ignores keys typed in fields.
- **Nothing is written:** viewing leaves the selection, the prompt draft and the Node Canvas transform untouched.
- **Poster labels:** the backend records where a clip's poster came from (`posterSource`: `frame` or `source`). The UI calls a poster "first frame" only for a real frame; otherwise it says "source image — not a frame extracted from the clip".

**Three zooms stay separate**
- **Viewer zoom:** local state of the viewer.
- **Node Canvas zoom:** React Flow, remembered in `nodeViewport`.
- **Windows UI scale:** reaches the app only as CSS px, through the tiers. Nothing scales the app with `transform`.

**Navigation (V6.1).** Four groups: Create image, Edit, Video and Publish.
- The DNA steps, Scene objects and Effects sit under a collapsible "Advanced DNA" with done/total steps. It opens by itself while one of them is active.
- Module ids, step numbers and statuses are unchanged.

**Help and type**
- **`HelpPopover`:** a "?" opens long explanations by click, Enter or Space. Esc returns focus, and the popover sits in a portal and flips so it is never cut. Cost and billing warnings stay as visible text.
- **Preset cards:** columns follow the panel width, labels clamp to two lines, and the full name is in the tooltip.
- **Type scale:** page 20, panel 16, section 14, body 14, field 13, secondary 12 and badge 11. No text is below 11 px.
- **Font:** the stack prefers Be Vietnam Pro, but it is not bundled yet (licence and offline files pending), so Inter / Segoe UI render.

**Not in V6.1**
- From V6.2–V6.5: the Draft Workflow graph, the Context Picker V6, Reference Node editing, Edit Detail, and undo/redo.
- A native "open file / folder" action, because no Tauri command exists for it.
- Pin Preview.

## ADR-045 — Imported images are editable sources; compact help and Blueprint branding

Accepted for implementation, 2026-10-21, based on the owner's follow-up screenshot and logo board.

- Node includes every imported project asset before generation. It mounts only after positions
  load, so the initial fit uses the real layout. Tray/import selection updates graph selection.
- Ordinary ready images can be quick-generate sources. A validated image reference enables
  variation, Enhance and Region edit without Master approval; local grading follows the selected
  ready image. Rust and mock enforce matching rules. Anchor/production prerequisites remain.
- Viewing or selecting does not promote a Master or change source bytes. Archived projects,
  videos, missing files, cross-project references and paid confirmation retain their existing guards.
- Shared field guidance uses `?` popovers. Validation errors, billing and task state remain visible.
- The supplied Blueprint board defines the cyan/violet arch, three towers and sparkle, with the
  name IMAGE-CREATIVE-ARCHITECT. SVG mark/icon, wordmark, favicon, native icons and installer name
  follow it. The app identifier and data directory remain unchanged.
- Verification and screenshots: `docs/design/imported-image-review/QA.md`.

## ADR-046 — Workflow progress is advisory; model selection is always visible

Accepted 2026-10-21 on the owner's request to remove step locks and expose image model selection.

- All DNA sections can be edited independently, including confirmed/review rows. Confirmation
  records progress only; no prior confirmation is required. Reopening never relocks generation.
- Image submission and batch queue insertion no longer gate on DNA, Master or Anchor approval.
  Keep archived-project, credential, ownership, file readiness, model capability, operation input,
  conflict and cost confirmation validation. Explicit user DNA section locks remain intentional.
- Provider and model selectors are always shown at the top of Generate, including Simple mode
  and single-model providers. Unconfigured providers can be selected; Generate then explains
  the missing key, and settings opens that provider. Advanced retains detailed output controls.
- Persisted workflow IDs, timestamps and project approval history remain compatible. Existing
  progress is not deleted or automatically confirmed. This supersedes sequencing in ADR-022/045.

## ADR-047 — Creative conflicts are advisory across image submission

Accepted 2026-10-21 after the owner's Dawn + City car + Vehicle light trails screenshot.
The effect checks marked a parked car plus long-exposure motion as a conflict and disabled
Generate even after workflow sequencing was removed in ADR-046.

- Keep the creative assessment and its original verdict/codes for guidance and history.
  Do not refuse or disable image generation, region editing, generative enhance, batches or
  retries because of creative findings. Do not drop individual batch items for such findings.
- Conflicts render as amber Creative suggestions with an explicit non-blocking explanation.
  Fixes and acknowledgement of warnings remain optional. Never automatically approve findings.
- Remove enforcement from both UI/store and Rust/mock validation. An advisory BLOCK snapshot
  remains compatible with old history and is preserved when submitting or retrying.
- Actual provider/key, file readiness/ownership, model parameter, archive, operation-input and
  spend-confirmation requirements remain. This does not change publishing/export fact checks.
- Browser and unit regressions use the exact supplied preset combination. Rust completes a
  local generation carrying creative findings and verifies batch/retry acceptance.

## ADR-048 — HHTECH has an official default endpoint

Accepted 2026-10-21 after a saved key could not connect because HHTECH_BASE_URL was missing.

- HHTECH defaults to https://hhtechapi.com/v1, the existing documented provider endpoint.
  Missing/blank environment values use this default; a nonblank explicit URL still overrides it.
- Explicit invalid/unsafe URLs remain errors, never silently redirected to a fallback host.
  Custom OpenAI-compatible gateways continue to require their own base URL.
- A saved OS credential or environment key now suffices to configure HHTECH. Missing keys
  still block calls. No key values are added to provider descriptors, logs or SQLite.
- Setup help and .env.example describe URL configuration as optional. No migration is needed.
- Regression checks cover missing/blank URL, explicit overrides, invalid configuration,
  saved-key detection and deletion, with existing mock HTTP tests covering /models and images.


## ADR-049 — Shared recommendations and compact design modules

Accepted 2026-10-22 for the interior/architecture menu update.

- Keep the shared workspace shell, persistent DNA, shot intent, Node graph, asset lineage and history. No database/schema migration is required. Legacy scene-object routes and stored selections remain readable; the standalone navigation entry is hidden.
- All DNA/module recommendations use the domain catalogue, bounded JSON recovery, option normalization, aggregate validation and one checked proposal UI. Rust transports text/vision results and bounded current context. `usage: null` is part of the backend contract. Authentication errors are distinct from exhausted quota.
- Add Style and Rooms as shared-shell modules. New projects ask only for a name and Interior/Architecture (new architecture projects use the existing `custom` type). Existing project types are untouched.
- Interior Space owns references; Style owns global material defaults. Material replacement and insertion of people/animals/decor/effects use selected regions, the existing mask engine and immutable output lineage. Region selection is synchronized between preview and inspector.
- Style thumbnails are two columns with explicit detail/apply; unavailable architecture thumbnails use a labelled placeholder rather than an interior photograph. Guide copy lives in the existing HelpPopover. Colour grading keeps the real-asset renderer and uses an empty state when no image is selected.
- Reference recommendations include draft DNA, image IDs, selected camera/module and selections; proposed controls are prechecked for review, never applied without the user's Apply action. Vision calls still use existing provider/spend confirmation and are not run live during automated QA.

## ADR-050 — Compile shot cameras consistently and keep context inside Space

Accepted 2026-10-23 for the camera/context follow-up.

- A shot visual intent becomes a deterministic transient camera used by the subject, camera and site/framing sections. It replaces the interior fallback entrance camera. An explicitly requested saved Camera Director camera remains authoritative; transient ids never enter persisted DNA, generation cameraId or provenance cameraId.
- Interior camera presets keep their existing stable ids and receive room-specific labels, compositions and lenses across the Generate grid, Camera selector and Node chips. Switching selectors synchronizes the same shot preset/visual intent fields and keeps purpose/focus settings.
- Variations exclude render-conversion presets whose preservation wording fixes the old camera. Source-image instructions explicitly allow the requested reframing. Shared provider role hints defer viewpoint/framing to those instructions; ordinary sketch rendering still explicitly preserves its source camera.
- Interior weather/time wording applies outdoors through existing openings and to indoor daylight. It must not turn rain, mist or ground reflections into indoor effects.
- Space contains six context icon choices and the existing advanced Context editor/confirmation. The legacy context route resolves to Space; no Context DNA fields, site evidence, asset roles, graph/history records or stored camera ids are migrated or deleted. Context locks/read-only mode remain in force.
- Prompt compiler is `pc-1.11.0`, preset catalogue `ps-1.3.0`; existing snapshots remain readable. Automated/browser QA uses isolated mock data and makes no paid provider calls.

## ADR-051 — Structured Interior Generate workflow

Accepted 2026-10-23 for the Interior Generate follow-up.

- Keep React/Zustand, the shared workspace shell, provider picker, queue, spend confirmation, canvas, Node graph, assets and history. Architecture and explicit saved Camera Director requests retain the existing compiler path.
- Add optional `ShotIntent.interiorGeneration` with schema version 1. Persist choices per project through the existing shot-intent storage and carry them in generation snapshots. No database migration or mutation of existing DNA is required. The Rust flattened `extra` map preserves the extension. An unsupported workflow field does not discard otherwise valid legacy shot choices.
- Config-driven goals, functional rooms, styles, change levels, preserve locks, indoor cameras and indoor lighting live in `packages/domain/src/generationPresets`. The UI stores ids and flags, never full prompts. Reuse Lucide SVGs at 24 px / 1.7 stroke; no generated icon assets are needed.
- Interior generation uses `pc-1.11.0/ig-1.0.0`. Its pure composer emits ordered sections and a negative/protection layer. Priority is hard locks, explicit instruction, goal, change level, selected reference permissions, style, room, AI advice, defaults. Region edits continue through their independent mask-preserving pipeline and therefore take precedence over whole-image locks.
- Keep legacy shot choices stored but omit inactive legacy camera/effect/preset fragments from the effective new-flow snapshot. The additional instruction is composed once. Room presets supply function only; they do not add furniture automatically.
- Hard-conflict resolution covers typed camera/reference permissions and bounded Vietnamese/English edit phrases. Block submission, including a resubmitted structured snapshot, until the user unlocks the affected category or explicitly removes the displayed conflicting sentence/permission. This is deterministic phrase matching, not unrestricted semantic understanding.
- Source is Image 1 even when a selective style reference has a master asset role. A source change invalidates old source observations and resets its camera. Backend request-only roles cannot grant broader permissions than the prompt; stored asset roles stay unchanged. The source, not a reference master, anchors output lineage. DNA-only designs have no source parent.
- Interior reference controls move from Space into Style and the Generate Style section. Start with style-only permission; colors, materials, furnishing layout and lighting require explicit selection. Material/color and layout/furniture locks are checked before permitting conflicting reference attributes. Reference architecture, openings and camera are never copied.
- Style and lighting advice use `dna_assist` chat/vision, the shared bounded JSON decoder, module schemas, loading/error/retry and explicit Apply. Style advice requires three distinct catalogue ids. Recommendations show suggested lighting/change level without silently applying them or starting generation. Region material advice can classify the selected surface through the existing region assist and filter its material catalogue.
- Result actions prepare a variation/realism/lighting draft or open the existing region editor, upscale panel, source image and before/after viewer. They do not create paid jobs. Undo returns to the source and restores its shot choices while retaining generated assets/history.
- Known limits: prompt hard locks guide generative providers but cannot guarantee pixel-identical geometry; region masks provide the existing outside-region pixel protection. Live vision/model quality requires a separate paid manual check. Existing large frontend chunk warning is unrelated to this workflow.

## ADR-052 — Share Camera DNA with the interior generation workflow

Date: 2026-10-23. Status: implemented locally, awaiting user review; no remote write.

`interiorGeneration.camera` gains optional `cameraId` and a `studio` mode. Pose data lives
only in the existing Camera DNA; the workflow references a stable CAM ID. Legacy states
without a link remain valid. `original` cannot link a planned camera, and `studio` requires
an ID. The compiler rejects missing/deleted links before generation rather than silently
falling back to another camera.

Workflow presets, the interior Camera inspector and Orbit use shared room-local poses and
lenses. Workflow preset selection updates the selected camera (or creates one when needed).
Editing Orbit/Director/Camera fields or applying a reviewed camera assist links the edited
camera in `studio` mode while the source-camera lock is off. Selecting another camera
updates the link; reopening restores the linked selection. A re-entrancy guard prevents the
workflow-to-DNA write from being interpreted as a second user edit.

A source-camera lock is never silently disabled. Camera DNA can still be planned while it
is active, but Generate retains the source angle; the UI shows that status and offers an
explicit unlock-and-use action. Source changes and locking transitions discard the link
via the existing `original` transition. Archived state is read-only.

The compiler resolves linked coordinates at compile time, includes exact room-local angles,
distance, height/lens where set, and snapshots the camera into prompt metadata. New prompt
versions are `pc-1.12.0` and `ig-1.1.0`; existing generation records are not rewritten.
The Rust ShotIntent DTO preserves these nested JSON fields through its existing extra map;
no Rust or database migration is introduced. Native execution still needs validation on a
machine with Cargo. Geometry remains estimated, without reconstruction/collision guarantees.
