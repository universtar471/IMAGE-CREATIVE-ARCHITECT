# Internal API Contracts

These are application-level contracts, not public HTTP APIs.

The desktop UI talks to Tauri commands. Keep command payloads typed and validated.

## 1. Standard result

Prefer explicit typed failures.

Concept:

```ts
type AppErrorCode =
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "IO_ERROR"
  | "DB_ERROR"
  | "CONFLICT"
  | "UNSUPPORTED_FILE"
  | "INVALID_STATE"
  | "DUPLICATE_ASSET"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_ERROR";

type AppError = {
  code: AppErrorCode;
  message: string;
  details?: unknown;
};
```

Do not send raw stack traces to the user UI.

## 2. Projects

### `project_create`

Request:
```ts
{
  name: string;
  projectType: ProjectType;
  subtype?: string;
}
```

Response:
```ts
ProjectDTO
```

Behavior:
- generate stable project ID
- create default validated DNA using Knowledge Pack if available
- insert project and DNA atomically
- create managed project folder if needed

### `project_list`

Request:
```ts
{
  includeArchived?: boolean;
}
```

Response:
```ts
ProjectSummaryDTO[]
```

### `project_get`

Request:
```ts
{ projectId: string }
```

Response:
```ts
{
  project: ProjectDTO;
  dna: ProjectDNA;
  assetSummary: AssetSummaryDTO[];
}
```

### `project_update_metadata`

Request:
```ts
{
  projectId: string;
  name?: string;
  subtype?: string;
}
```

### `project_set_archived`

Request:
```ts
{
  projectId: string;
  archived: boolean;
}
```

## 3. DNA

### `dna_get`

```ts
{ projectId: string }
```

### `dna_update`

```ts
{
  projectId: string;
  dna: ProjectDNA;
}
```

Behavior:
1. validate entire aggregate
2. reject invalid values
3. persist atomically
4. update project timestamp
5. optionally derive state `dna_ready` when minimum required fields are present

Avoid patching unvalidated fragments directly into raw JSON.

The frontend can use local form state, then submit a validated complete section/aggregate.

## 4. Assets

### `asset_import`

Request:
```ts
{
  projectId: string;
  sourcePath: string;
  source: AssetSource;
  role: AssetRole;
}
```

Response:
```ts
AssetDTO
```

Import service:
- verify project exists and is not archived
- validate supported file
- inspect metadata
- SHA-256
- copy to managed originals directory
- insert asset record
- return DTO

### `asset_list`

```ts
{ projectId: string }
```

### `asset_update_role`

```ts
{
  projectId: string;
  assetId: string;
  role: AssetRole;
}
```

If role becomes `master_architecture`, route through the same invariant as `asset_set_master`.

### `asset_set_master`

```ts
{
  projectId: string;
  assetId: string | null;
}
```

Behavior:
- referenced asset must belong to project
- update previous master role if necessary according to chosen UX
- guarantee max one active master

Recommended rule:
- selecting a new master changes the old master from `master_architecture` to `architecture_reference`
- new asset role becomes `master_architecture`

### `asset_remove`

Phase 1 should default to safe removal.

Rules:
- confirm in UI
- if master, clear master first
- remove DB record + managed original only if file is owned by app
- never delete the user's original source file outside managed storage

## 5. Prompt compiler

### `prompt_compile_preview`

Request:
```ts
{ projectId: string }
```

Response:
```ts
PromptBundle
```

Compiler must use persisted validated data, not unsaved UI text.

Optionally add a pure frontend preview later, but backend remains canonical.

## 6. Knowledge packs

### `knowledge_list_subtypes`

```ts
{ projectType: ProjectType }
```

### `knowledge_get_defaults`

```ts
{
  projectType: ProjectType;
  subtype?: string;
}
```

Return:
- default Building DNA partial
- default Context DNA partial
- suggested negative constraints
- metadata such as pack version

## 7. Future contracts — define interfaces only

Do not implement providers in Phase 1.

Future:
- `generation_submit`
- `edit_submit`
- `upscale_submit`
- `job_list`
- `job_cancel`
- `qc_run`
- `export_batch`

Their existence should not distort Phase 1 code.

## 8. Phase 1 implementation notes

All commands take a single `request` argument (`invoke(cmd, { request })`) and return
`Result<T, AppError>`. Additions and deviations from the sections above:

- `AppErrorCode` also includes `DUPLICATE_ASSET` (details: `existingAssetId`, `fileName`).
- `project_create` request carries the resolved `dna` (built in the UI from the Knowledge
  Pack via `createInitialDNA`); the backend validates it against the exported JSON Schema
  and inserts project + DNA in one transaction (ADR-008).
- `project_get` returns `{ project, dna, assets }` (full `AssetDTO`s).
- `project_approve_master { projectId, approved }` → `ProjectDTO` (new, ADR-009).
- `asset_import` accepts `allowDuplicate?: boolean` (ADR-010).
- `asset_update_role` and `asset_set_master` return the project's full `AssetDTO[]`.
- `asset_remove` returns `{ assetId, fileCleanupWarning }`.
- `version_list { projectId }` → `VersionDTO[]` (import lineage).
- `app_info` → `{ dataRoot, schemaVersion, appVersion }`.
- `knowledge_*` commands are not needed in Phase 1: packs are bundled into the UI.
- `prompt_compile_preview` is a UI application service (`compilePromptPreview`), compiling
  persisted data loaded with `project_get` (ADR-008).

## 9. Phase 2 contracts — providers and generation

Zod source of truth: `packages/domain/src/schemas/generation.ts`. Rust mirrors it in
`src-tauri/src/providers/mod.rs` + `src-tauri/src/dto.rs` (camelCase). New error code:
`PROVIDER_NOT_CONFIGURED` (details: `{ providerId }`).

Capabilities and params added for priced gateways (HHTECH, §11):
- `ModelCapabilities.qualityOptions`: `("low" | "medium" | "high")[]`, the values
  `GenerationParams.quality` may take; empty for official OpenAI (always sends `high`), Gemini
  and `local_preview`.
- `ModelCapabilities.priceHint`: `Record<tier, VND> | null`, estimated price per image by
  `imageSizes` tier; a tier missing from the map has no published price; `null` for every
  provider except HHTECH catalog models. The UI multiplies it by the image count.
- `GenerationParams.quality`: `"low" | "medium" | "high" | null`; `null` = the provider's
  default. Requests and stored rows without the field read as `null`.

| Command | Request | Response |
|---|---|---|
| `provider_list` | `{}` | `ProviderDescriptorDTO[]` |
| `provider_set_api_key` | `{ providerId, apiKey }` | `ProviderDescriptorDTO` |
| `provider_clear_api_key` | `{ providerId }` | `ProviderDescriptorDTO` |
| `provider_test` | `{ providerId }` | `ProviderTestResult` (`ok:false` is not an error) |
| `generation_submit` | `GenerationSubmitRequest` | `GenerationDTO` (`completed` or `failed`) |
| `generation_list` | `{ projectId }` | `GenerationDTO[]`, newest first |
| `generation_get` | `{ projectId, generationId }` | `GenerationDTO` |
| `version_list` | unchanged | `VersionDTO[]`, now with `generationId: string \| null` |

`generation_submit` returns `AppError` only when nothing was sent to a provider:
- `NOT_FOUND` — project, provider, model or reference asset unknown
- `INVALID_STATE` — project archived, reference file missing
- `VALIDATION_ERROR` — empty positive prompt, duplicate references, too many references,
  `outputCount` above `maxOutputs`, `aspectRatio`/`imageSize` not in the model's list
  (an empty list means the provider decides, so the value must be `null`), `seed` set on a model without seed support,
  `quality` not in the model's `qualityOptions` (empty = only `null`), references on a
  model without image-to-image, no references on a model without text-to-image
- `PROVIDER_NOT_CONFIGURED` — provider needs a key and none is available

Provider errors after the call started are returned as a `failed` `GenerationDTO` with
`error = { kind, message, retryable }`; `kind` ∈ `auth | rate_limited | blocked |
invalid_request | network | timeout | bad_response | interrupted`.
`interrupted` also marks a job (and its generation) that ended `failed` for a reason of the
app's own, with `retryable: true` and no automatic retry: its worker thread could not be
started, or the attempt panicked (the message carries the cause). After a restart, a job
that was running when the app closed is `interrupted` itself (status, not only kind).

Never returned or logged anywhere: the API key, vendor request bodies, raw vendor responses.

## 10. Phase 3 contracts — cameras, anchors, jobs, batches

Zod source of truth: `packages/domain/src/schemas/jobs.ts`, `schemas/generation.ts`,
`schemas/future.ts` (`CameraDNASchema`), `knowledge/pack.ts` (`CameraPresetSchema`).

Changed Phase 2 shapes:
- `GenerationStatus` adds `queued`, `cancelled`; `GenerationPurpose` adds `anchor`, `production`.
- `GenerationDTO` adds `cameraId`, `batchId`, `jobId`, `createdAt`; `startedAt` becomes nullable
  (null while queued).
- `GenerationSubmitRequest` adds `cameraId` (nullable, default null); it must exist in the DNA.
- `generation_submit` enqueues one job and returns the `queued` `GenerationDTO` immediately;
  validation errors are unchanged (still `AppError`, nothing enqueued).

New commands:

| Command | Request | Response |
|---|---|---|
| `batch_create` | `BatchCreateRequest` | `BatchDTO` (all jobs `queued`) |
| `batch_list` | `{ projectId }` | `BatchDTO[]`, newest first |
| `job_list` | `{ projectId: string \| null }` (null = all projects) | `JobDTO[]`: all non-terminal + the 100 most recent terminal, newest first |
| `job_cancel` | `{ jobId }` | `JobDTO` (`INVALID_STATE` if already terminal) |
| `job_retry` | `{ jobId }` | new `JobDTO` (copies the request into a new generation + job; only for `failed`/`cancelled`/`interrupted`) |
| `camera_anchor_list` | `{ projectId }` | `CameraAnchorDTO[]` |
| `camera_anchor_set` | `{ projectId, cameraId, assetId }` | `CameraAnchorDTO[]` (camera must be an anchor view in the DNA; asset ready, same project) |
| `camera_anchor_clear` | `{ projectId, cameraId }` | `CameraAnchorDTO[]` |

`batch_create` validates every item like `generation_submit` before inserting anything
(all-or-nothing). Events (Tauri `emit`, payload = DTO): `job://updated` (`JobDTO`),
`generation://updated` (`GenerationDTO`).

## 11. Prompt enhancement and the HHTECH provider

Zod source of truth: `PromptEnhanceRequestSchema` / `PromptEnhanceResultSchema` in
`packages/domain/src/schemas/generation.ts`; Rust: `src-tauri/src/services/prompt_enhance.rs`.

| Command | Request | Response |
|---|---|---|
| `prompt_enhance` | `{ projectId, providerId, text, context }` | `{ text }` |

- `text`: the user's editable extra prompt (1–4000 chars after trimming). `context`: Project DNA
  facts to keep (the UI sends the compiled positive + preservation text; ≤ 20000 chars, may be
  empty). Nothing is stored; the UI previews the result for Accept / Discard.
- The provider must offer chat (today only `hhtech`, model `HHTECH_CHAT_MODEL`); the backend
  sends a fixed system prompt (more specific materials, light, camera, atmosphere; keep every
  DNA fact; no invented dimensions; return only the prompt) and the user message
  `Project DNA context (facts to preserve): … Prompt to rewrite: …`.
- Errors: `NOT_FOUND` (project or provider), `VALIDATION_ERROR` (empty/too long text or context,
  provider without chat), `PROVIDER_NOT_CONFIGURED` (no key, or the provider's own setup problem
  such as a missing `HHTECH_BASE_URL`; details `{ providerId }`), and the new `PROVIDER_ERROR`
  for a failed call, details `{ providerId, kind, retryable }` with `kind` as in §9.

Provider `hhtech` ("HHTECH (OpenAI-compatible)", remote, key required) appears in
`provider_list` between `openai` and `local_preview`. Its models are the built-in catalog
(`providers/hhtech/catalog.rs`; order: `gpt-image-2.5-sunburst`, `gemini-3-pro-image`,
`gpt-image-2.5-flare`, `gpt-image-2`, `gemini-3.1-flash-image`, `gemini-2.5-flash-image`),
restricted and reordered by `HHTECH_IMAGE_MODEL` when set (ids outside the catalog: plain
entries, no `imageSizes`, `priceHint: null`). Catalog models have the ten GPT Image aspect
ratios, `imageSizes` with the gateway's published, billed tiers (GPT `["1K","2K","4K"]`, Gemini
`["2K","4K"]`), labels with the
price list and a `priceHint`. GPT models: `qualityOptions` low/medium/high, 16 references, tier
sent as `size` (long edge 1024/2048/3840 by aspect ratio, multiples of 16). Gemini models: no
quality options, 14 references (unverified beyond 1), tier sent as the model id (`<base>-2k`,
`<base>-4k`; 2K when no tier is given; never the bare base id or `-edit-*`) with the computed
size for the aspect. GPT without a tier: `HHTECH_IMAGE_SIZE` as before. Generation `meta` records `tier` and `requestModel` (the id
sent). `configured` is false while
`HHTECH_BASE_URL` is missing or invalid, even if a key exists (`keySource` still says where the
key is). Base URL, models, size, quality and chat model are read from the environment / `.env`
only and never appear in SQLite, logs or DTOs other than the model ids.

## 12. Phase 4 contracts — lighting, weather, mood, color grade

### 12.1 DNA (additive, schema v1 stays valid)

- `LightingDNA`: existing fields plus `presetId?: string`. `timeOfDay` uses the vocabulary
  `dawn | morning | midday | afternoon | golden_hour | blue_hour | night` (stored as string,
  validated by the UI select). `artificialLighting[]` items gain `id` (`LGT_<ULID>`),
  `enabled` (default true) and `zone` vocabulary `facade_uplights | interior_glow |
  landscape | pool | soffit_downlights | signage | street` (free text still allowed).
- `WeatherDNA`, `MoodDNA`: existing fields plus `presetId?: string` (`preset` keeps the label).
- `LockState.mood: boolean` (default false).
- `ColorGradeDNA`: unchanged sliders; `look?: string` = id of a built-in look (§12.3).

### 12.2 Knowledge pack 1.2.0

`lightingPresets`, `weatherPresets`, `moodPresets`: arrays of
`{ id, label, tags: string[], values: Partial<section> }`. A mood preset's `values` may also
carry `lighting?: Partial<LightingDNA>` and `weather?: Partial<WeatherDNA>` so one mood can
coordinate atmosphere with its light and weather. Every pack ships at least
4 lighting, 3 weather and 4 mood presets; tropical packs include monsoon/rain and
blue-hour presets. `KnowledgeRegistry` resolves them like camera presets
(subtype pack, type default, custom fallback).

### 12.3 Color grade pipeline (TS and Rust must match within ±1 per 8-bit channel)

Per pixel, sRGB 8-bit → floats `c = (r,g,b)/255`, then in this order (`k = slider/100`):

1. Exposure: `lin = srgbToLinear(c) * 2^exposure`; `c = linearToSrgb(clamp01(lin))`
   (IEC 61966-2-1 curves).
2. Temperature / tint: `r += 0.10*kTemp`, `b -= 0.10*kTemp`, `g -= 0.10*kTint`.
3. Contrast: `c = (c - 0.5) * (1 + kContrast) + 0.5`.
4. With `L = 0.2126r + 0.7152g + 0.0722b` (recomputed after each step that changes c):
   highlights `c += 0.25*kHighlights*smoothstep(0.5,1,L)`;
   shadows `c += 0.25*kShadows*(1 - smoothstep(0,0.5,L))`;
   whites `c += 0.15*kWhites*L²`; blacks `c += 0.15*kBlacks*(1-L)²`.
5. Clarity (midtone contrast): `c += 0.8*kClarity*(c - 0.5)*L*(1-L)`.
6. Dehaze: `d = 0.10*kDehaze`; `c = (c - d) / (1 - d)` (for d<0 this lifts blacks).
7. Vibrance: `s = max(c)-min(c)`; `c = L + (c - L)*(1 + kVibrance*(1 - s))`.
8. Saturation: `c = L + (c - L)*(1 + kSaturation)`.
9. Clamp to [0,1], `round(c*255)`. Alpha passes through unchanged.

Built-in looks (`look` ids, each a full slider set; selecting one fills the sliders):
`neutral`, `warm_tropical`, `cool_modern`, `soft_editorial`, `cinematic_dusk`,
`bright_magazine`. Test vectors: `packages/domain/test-vectors/grade.json` =
`[{ grade, input: [[r,g,b],…], output: [[r,g,b],…] }]` produced by the TS implementation.

### 12.4 Commands

| Command | Request | Response |
|---|---|---|
| `grade_apply` | `{ projectId, assetId, grade: ColorGradeDNA, label?: string }` | `AssetDTO` (new asset) |

- Source must be a `ready` image asset of the project; errors `NOT_FOUND`, `VALIDATION_ERROR`.
- Writes the graded PNG (8-bit RGB/RGBA, same size), thumbnail, asset row (role
  `regular_image`, `source` = the source asset's source), version row (`operation =
  "color_grade"`, `operation_json` = grade, `parent_version_id` = source's latest version,
  label = `label` or "Color grade"). Transactional with file cleanup like generation outputs.
- Runs off the UI thread; large images (≤ 8K long edge) must not block other commands
  (no DB lock held while processing).

Mood variations use `batch_create` unchanged (ADR-021).

### 12.5 Asset preview (binary)

`asset_preview` returns a PNG preview for the live color-grade canvas. The request is
`{ projectId, assetId, maxEdge }`; `maxEdge` is clamped to `256..4096` (the UI uses `1600`).
The asset must belong to the project, be a ready image, and its source file is never modified.
The response is raw binary PNG data (`tauri::ipc::Response`), downscaled to fit the requested
long edge without upscaling while preserving aspect ratio. This command is intentionally
excluded from the JSON contract fixtures because its response is binary rather than JSON.

## 13. Phase 4B contracts — guided workflow (ADR-022)

### 13.1 Steps (ordered; ids are stable strings)

| id | stage | module (ModuleId) | how it completes |
|---|---|---|---|
| `dna.building` | dna | `design_dna` (label "Kiến trúc") | manual confirm |
| `dna.context` | dna | `context` | manual confirm |
| `dna.references` | dna | `references` | manual confirm (a master is optional here) |
| `dna.camera` | dna | `camera` | manual confirm (0 cameras allowed) |
| `dna.lighting` | dna | `lighting` (lighting + weather) | manual confirm |
| `generate.master` | generate | `generate` step 1 | derived: project has an approved master |
| `generate.anchors` | generate | `generate` step 2 | derived: every anchor-view camera has an approved anchor; `skipped` if none |
| `generate.render` | generate | `generate` step 3 | never completes (production step) |
| `post.grade` | post | `mood_grade` | never completes |

Persisted per project, only for the five `dna.*` steps: `WorkflowStepState = { stepId, status: "open" | "confirmed" | "needs_review", confirmedAt: string | null }`. A missing row means `open`.

### 13.2 Derived view (domain, pure: `deriveWorkflow(persisted, facts)`)

`facts = { masterApproved: boolean, anchorCameraIds: string[], approvedAnchorCameraIds: string[] }`

Each step gets `status`:
- `locked`
- `available`
- `confirmed` (dna steps)
- `needs_review`
- `done` (derived generate steps)
- `skipped`

A locked step also gets `blockedBy: StepId`.

Unlock rules:
- `dna.building` is always unlocked.
- Each later `dna.*` step unlocks when the previous `dna.*` step is `confirmed`. `needs_review` does not count.
- `generate.master` is `locked` (blocked by the first unconfirmed DNA step) whenever any `dna.*` step is open or `needs_review`; otherwise it is `done` when the project has an approved master and `available` when it does not.
- `generate.anchors` and `generate.render` are `locked` while DNA is incomplete (blocked by the first unconfirmed DNA step); once DNA is complete, their existing master/anchor/camera rules apply. Anchors are `skipped` when there are no anchor-view cameras, and Render is `skipped` when there are no cameras.
- `post.grade` unlocks when `masterApproved`.

Stage summary: `{ dna | generate | post: { unlocked: boolean, complete: boolean } }`.

Helpers (also used by the mock backend):
- `confirmStep(persisted, stepId, now)`: allowed only when the step is unlocked.
- `reopenStep(persisted, stepId)`: sets the step `open` and every later `confirmed` dna step to `needs_review`.

Both return a new `persisted` value and throw a clear error on an invalid step or a locked step.
`needs_review` is read-only until `reopenStep` changes it to `open`; only then may the user review and confirm it again.

### 13.3 Commands

- `workflow_get { projectId } -> { steps: WorkflowStepState[] }`. Always returns all five dna steps, filling missing rows as `open`.
- `workflow_confirm_step { projectId, stepId } -> same shape`
  - `validation_error` for a non-dna step id or a locked step: previous dna step not confirmed.
  - Archived project → the existing archived error.
- `workflow_reopen_step { projectId, stepId } -> same shape`
  - Semantics as `reopenStep`.
  - `validation_error` if the step is not `confirmed` / `needs_review`.

### 13.4 Backend generation gating

`generation_submit` and `batch_create` check the workflow before queuing any job. The error is `validation_error` with a message naming the step to finish first.
- purpose `hero` needs all dna steps confirmed
- `anchor` needs all dna steps confirmed + approved master
- `production` needs all dna steps confirmed + approved master + every anchor-view camera anchored
- `variation` needs an approved master

### 13.5 Migration

Migration `0004_workflow.sql`: table `workflow_steps(project_id, step_id, status, confirmed_at, PRIMARY KEY(project_id, step_id))`. Backfill: every existing project whose master is approved gets all five dna steps `confirmed` (confirmed_at = migration time), so existing work is not suddenly locked. Other projects start with no rows (= `open`).

## 14. Phase 5 contracts — enhancement (ADR-023)

### 14.1 Params

`GenerationPurpose` gains `"enhance"`. An enhance request is an ordinary `generation_submit` / batch item with `purpose: "enhance"`, exactly one reference (the source asset, role treated as master), and `params.enhance`:

```ts
EnhanceParams = {
  mode: "conservative" | "generative",
  targetLongEdge: 2048 | 3072 | 4096 | null, // null = keep source size (generative only)
  detailStrength: number,      // integer 0..100, default 40
  architecturePreserve: boolean // default true
}
```

Validation:
- `conservative` requires `targetLongEdge` not null, and `providerId: "local_upscale"`.
- `generative` requires a provider whose model supports image references.
- A target smaller than the source long edge is rejected with `validation_error` ("Enhancement never downsizes; pick a larger target.").
- An effective long edge above 8192 is rejected.

The prompt for `generative` comes from domain `buildEnhancePrompt({ dna, params })`. `conservative` sends no prompt; the compiled prompt fields are empty strings.

### 14.2 Provider `local_upscale`

Capabilities:
- `kind` local
- no key
- one model `lanczos3` (label "Conservative upscale (local)")
- references 1
- outputs 1
- no seed / negative
- `qualityOptions` []
- `priceHint` null

The output is PNG.

Unsharp mask:
- radius 1.0 px at the output scale
- amount = `detailStrength / 100 * 0.6`
- threshold 2/255

### 14.3 Output

- Every enhance output is resized (Lanczos3) to exactly `targetLongEdge` on the long side, keeping aspect, when that is set.
- The asset role is `regular_image`.
- The version has `operation = "enhance"`, `operation_json` = the params plus the provider/model actually used, and `parent_version_id` = the source's latest version.
- Meta records `sourceLongEdge`, `providerLongEdge` and `finalLongEdge`.

### 14.4 Gating

ADR-022 §13.4 is extended: `enhance` needs an approved master, like `variation`.

## 15. Phase 6 contracts — Vision QC (ADR-024)

> **Removed by ADR-033.** The `qc_*` commands, the QC schemas and auto QC/repair no longer exist.
> The `qc_reports` / `qc_settings` tables (migration 0005) stay so old databases open; the
> `repair` generation purpose is kept only so old history displays, and new repairs are rejected.
> This section is kept as history.

### 15.1 Shapes (Zod in `packages/domain/src/qc/`, Rust DTOs camelCase)

```ts
QcScores = { geometry: number, material: number, openings: number, context: number, lighting: number } // ints 0..100
QcArtifact = { label: string, severity: "low" | "medium" | "high", box: [number, number, number, number] | null } // box normalised 0..1
QcIssue = { category: "geometry" | "material" | "openings" | "context" | "lighting" | "artifact", text: string }
QcVision = { providerId: string, model: string, scores: QcScores, artifacts: QcArtifact[], issues: QcIssue[], repairInstruction: string }
QcLocal = { edgeAlignment: number | null, sharpness: number, clippedPct: number }
QcSettings = { schemaVersion: 1, passMin: number /*0..100, 70*/, categoryMin: number /*0..100, 55*/, highArtifactFails: boolean /*true*/,
               autoQc: "off" | "after_generation" /*off*/, autoRepairMax: 0 | 1 | 2 /*0*/,
               visionProviderId: string | null, visionModel: string | null }
QcReportDTO = { id: "QC_<ULID>", projectId, assetId, referenceAssetIds: string[], local: QcLocal, vision: QcVision | null,
                overall: number | null, result: "pass" | "warn" | "fail" | "unscored", thresholds: { passMin, categoryMin, highArtifactFails },
                createdAt: string }
```

The domain exposes these pure functions; the Rust side mirrors the result rules.

| Function | Purpose |
|---|---|
| `scoreReport(local, vision, thresholds)` | returns `{ overall, result }` per ADR-024 |
| `parseVisionReply(text)` | lenient JSON extraction plus validation; throws on invalid input |
| `buildVisionPrompt({ dna, purpose })` | the system and user text for the judge |
| `buildRepairPrompt({ dna, report })` | the repair prompt |

### 15.2 Commands

| Command | Request | Response |
|---|---|---|
| `qc_run` | `{ projectId, assetId, vision: { providerId, model? } \| null }` | `QcReportDTO` |
| `qc_list` | `{ projectId, assetId? }` | `QcReportDTO[]`, newest first |
| `qc_settings_get` | `{ projectId }` | `QcSettings` (defaults when unset) |
| `qc_settings_set` | `{ projectId, settings: QcSettings }` | `QcSettings` |

`qc_run`:
- Validates that the asset belongs to the project and is ready.
- Gate: needs an approved master. On failure it returns `validation_error`.
- Runs local metrics, then vision if requested. No DB lock is held during image work or the network call.
- Inserts into `qc_reports`.
- Errors map like other provider errors, with keys redacted.
- An archived project returns the existing archived error.

### 15.3 Repair

`GenerationPurpose` gains `"repair"`. Request: `params.repair = { qcReportId }`, plus exactly two references:
1. the report's asset
2. the report's primary reference

When the purpose is `repair`, the backend checks that the report belongs to the project and the asset matches. Gating is the same as `variation`. Meta records `repairOf` (asset id) and `repairDepth`.

### 15.4 Storage

Migration `0005_qc.sql`:
- `qc_reports(id, project_id, asset_id, report_json, result, created_at)`, as in `DATA_MODEL.md`, plus an index on `(project_id, asset_id, created_at)`.
- `qc_settings(project_id PRIMARY KEY, settings_json, updated_at)`.

Both cascade on project delete; reports also cascade on asset delete.

### 15.5 Automation

After `commit_outputs` of every successful generation (including `repair` outputs), when `autoQc = after_generation`:
1. The backend runs `qc_run` for each output on a background thread, sequentially per project, using the stored vision provider/model (or local only).
2. If the result is `fail` and `repairDepth < autoRepairMax`, it submits one repair generation through the normal gated path. A repair output is QC'd even when its depth has reached `autoRepairMax`; it simply cannot enqueue another repair.

Failures of automation are logged and stored nowhere else. They never fail the original generation.

## 16. Phase 7 contracts — region editing (ADR-025)

### 16.1 Shapes (Zod in `packages/domain/src/regions/`, Rust DTOs camelCase)

```ts
RegionShape =
  | { type: "rect", x: number, y: number, w: number, h: number }                // normalised 0..1
  | { type: "polygon", points: [number, number][] }                             // >= 3 points
  | { type: "brush", strokes: { points: [number, number][], radius: number }[] } // points >= 1; radius normalised to the long edge
RegionDTO = { id: "RGN_<ULID>", projectId, assetId, label: string, kind: "object" | "zone" | "material",
              objectId: string | null, shape: RegionShape, createdAt: string, updatedAt: string }
SceneObject = { id: "OBJ_<ULID>", name: string,
                category: "wall" | "roof" | "window" | "door" | "floor" | "landscape" | "furniture" | "sky" | "other",
                material?: string, relations: { type: "on" | "next_to" | "inside" | "above" | "below", targetId: string }[] }
ProjectDNA.scene = { schemaVersion: 1, objects: SceneObject[] } // optional, additive
RegionEditParams = { regionIds: string[] /* >= 1 */, instruction: string, mode: "edit" | "material_replace", material?: string }
```

Validation:
- `material` is required when `mode` is `material_replace`.
- `instruction` may be empty only in that mode.

Domain pure functions:
- `rasterizeMask(shapes, width, height) -> Uint8Array`: 255 inside, 0 outside, union. Polygon uses even-odd fill. A pixel is inside when its centre is inside. Brush draws discs at every point and capsules between consecutive points.
- `featherMask(mask, width, height, radiusPx) -> Uint8Array`: three passes of a 2D box blur over a `(2r+1)²` window, where `r = round(radiusPx)`. Samples outside the image are excluded and each pixel is averaged over the in-image sample count. Round half up to an integer after every pass.
- `buildRegionEditPrompt({ dna, regions, params, nativeMask })`.
- Scene helpers:
  - `newSceneObjectId()`
  - `sceneObjectLines(dna)`: the prompt lines for pinned objects
  - The compiler includes pinned-object preservation lines. The compiler version bumps to `pc-1.3.0`.
- Test vectors: `packages/domain/test-vectors/masks.json`. Small sizes; all three shape types, a union and feathering. Rust must match exactly. Feathering may differ by ±1 per pixel.

### 16.2 Commands

| Command | Request | Response |
|---|---|---|
| `region_list` | `{ projectId, assetId }` | `RegionDTO[]` |
| `region_save` | `{ projectId, assetId, region: { id?, label, kind, objectId, shape } }` | `RegionDTO` (create when no `id`, else update) |
| `region_delete` | `{ projectId, regionId }` | `{ deleted: true }` |

- `region_save` validates the shape and requires that the `objectId` exists in `dna.scene` when it is set.
- An archived project returns the existing error.

### 16.3 Region edit generation

- `GenerationPurpose` gains `"region_edit"`. Gating is the same as `variation`.
- The request has exactly one reference, the asset, plus `params.region`.
- Every `regionId` must belong to that asset.
- Model capabilities gain `supportsMask: boolean`:
  - true: OpenAI official, HHTECH GPT models
  - false: Gemini, local
- Backend steps:
  1. Rasterise the union at the source size.
  2. Native: send `mask` (PNG; alpha 0 = edit) in images/edits.
  3. Otherwise: add the mask, as a white-on-black PNG, as a second image after the source. Tell the model about it in the prompt.
  4. Resize the provider output to the source size.
  5. Composite with the mask feathered by 8 px.
  6. Write the new asset and version: `operation = "region_edit"`, `operation_json = { params, regionShapes, nativeMask, maskCoveragePct, providerId, model }`.
- Output metadata records `nativeMask` and `maskCoveragePct`; `maskCoveragePct` is the unfeathered union coverage at source size, rounded to 0.1 percent.

### 16.4 Storage

Migration `0006_regions.sql` creates `regions(id, project_id, asset_id, label, kind, object_id, shape_json, created_at, updated_at)`:
- index on `(project_id, asset_id)`
- cascade on project and asset delete


## 17. Sketch / massing source (ADR-026)

### 17.1 Role

- `AssetRole` gains `"structure_sketch"`, in Zod and in the Rust `AssetRole` enum (snake_case).
- `REFERENCE_ROLE_ORDER` becomes `master_architecture`, `structure_sketch`, then the existing order.
- `DEFAULT_REFERENCE_ROLES` excludes `structure_sketch`, as it already excludes `regular_image`.
- The role is valid for import (`asset_import` role) and for `asset_set_role`.
- Labels:

  | | Full | Short |
  |---|---|---|
  | vi | "Phác thảo / khối" | "Phác thảo" |
  | en | "Sketch / massing" | "Sketch" |

### 17.2 Compiler (`pc-1.3.0`)

- `ROLE_INSTRUCTIONS.structure_sketch`: "is the STRUCTURE source (sketch, massing model or 3D view): keep its building geometry, camera viewpoint, proportions, floor count, openings and roof form exactly; render it as a finished photorealistic building with the materials, lighting and context described below; do not add or remove building parts."
- Preservation line, when a structure sketch is present: "Follow the geometry and viewpoint of Image N (structure sketch) exactly; replace sketch lines, flat colours and model textures with real materials."

### 17.3 UI form

`GenerateForm` gains `source: "dna" | "sketch"`.
- Draft field: `source`.
- Default: `"dna"`.

When `source` is `"sketch"`:
- `purpose` is `"hero"`.
- `pinnedIds = [sketchId]`. `sketchId` is the chosen ready `structure_sketch` asset; by default, the newest one.
- The aspect ratio anchors on the sketch.
- Generation is disabled, with a reason, when:
  - there is no sketch asset, or
  - the model has no image-to-image.


## 18. Interior DNA (ADR-027)

### 18.1 Schema (`packages/domain/src/interior/schemas.ts`)

```ts
InteriorDNA = {
  schemaVersion: 1,
  buildingUseId: BuildingUseId,            // required
  roomId: RoomId,                          // required, must be valid for buildingUseId
  styleId: InteriorStyleId,                // required
  paletteId?: PaletteId,
  materialPresetId?: MaterialPresetId,
  surfaces: {                              // each defaults to []
    floor: FloorMaterialId[], wall: WallMaterialId[], ceiling: CeilingMaterialId[],
    cabinetry: CabinetryMaterialId[], countertop: CountertopMaterialId[],
    textile: TextileMaterialId[], metal: MetalFinishId[],
  },
  daylightDirection?: "front" | "left" | "right" | "rear" | "diffuse" | "none",
  daylightAmount?: "low" | "medium" | "high",
  timeOfDay?: "morning" | "midday" | "afternoon" | "golden_hour" | "evening" | "night",
  artificialScenes: ("ambient" | "task" | "accent" | "cove" | "pendant" | "downlight")[], // default []
  colorTemperatureK?: 2700 | 3000 | 3500 | 4000,
  furnitureIds: FurnitureId[],             // default []
  furnishingDensity: "minimal" | "balanced" | "layered",  // default "balanced"
  cameraPresetId?: "wide_entrance" | "corner" | "one_point" | "detail",
  areaM2?: number /* > 0 */, ceilingHeightM?: number /* > 0 */,
}
ProjectDNA.interior?: InteriorDNA   // optional, additive
```

Validation:
- `roomId` must be in `roomsForUse(buildingUseId)`. If it is not, the error is at `interior.roomId`.
- Surface ids must belong to their slot.

### 18.2 Catalog ids (each option: `{ id, vi, en, prompt }`)

**BuildingUseId**

| id | vi | prompt |
|---|---|---|
| `apartment` | Căn hộ | apartment |
| `studio` | Studio | studio apartment |
| `duplex_penthouse` | Duplex / Penthouse | duplex penthouse |
| `townhouse` | Nhà phố | townhouse |
| `single_storey_house` | Nhà cấp 4 | single-storey house |
| `villa` | Biệt thự | villa |
| `hotel_room_suite` | Phòng / suite khách sạn | hotel suite |
| `office` | Văn phòng | office |
| `cafe_restaurant` | Café / nhà hàng | café restaurant |
| `retail_showroom` | Cửa hàng / showroom | retail showroom |
| `spa` | Spa | spa |
| `resort` | Resort | resort |
| `other` | Khác | interior |

**RoomId**

| id | vi | prompt |
|---|---|---|
| `living_room` | Phòng khách | living room |
| `kitchen` | Bếp | kitchen |
| `dining_room` | Phòng ăn | dining room |
| `living_kitchen` | Khách + bếp | open-plan living and kitchen |
| `master_bedroom` | Phòng ngủ master | master bedroom |
| `bedroom` | Phòng ngủ | bedroom |
| `kids_room` | Phòng trẻ em | children's bedroom |
| `bathroom` | Phòng tắm / WC | bathroom |
| `walk_in_closet` | Phòng thay đồ | walk-in closet |
| `home_office` | Phòng làm việc | home office |
| `prayer_room` | Phòng thờ | Vietnamese family altar room |
| `lobby` | Sảnh | lobby |
| `reception` | Lễ tân | reception area |
| `meeting_room` | Phòng họp | meeting room |
| `open_office` | Khu làm việc chung | open-plan office |
| `cafe_dining` | Khu khách café / nhà hàng | café dining area |
| `bar_counter` | Quầy bar | bar counter |
| `retail_floor` | Khu bán hàng | retail floor |
| `spa_treatment` | Phòng trị liệu | spa treatment room |
| `other` | Khác | interior room |

**`roomsForUse(use)`**

| Building uses | Rooms |
|---|---|
| `apartment`, `duplex_penthouse`, `townhouse`, `single_storey_house`, `villa` | `living_room`, `kitchen`, `dining_room`, `living_kitchen`, `master_bedroom`, `bedroom`, `kids_room`, `bathroom`, `walk_in_closet`, `home_office`, `prayer_room` (townhouse and villa also get `lobby`) |
| `studio` | `living_kitchen`, `bedroom`, `bathroom`, `walk_in_closet`, `home_office` |
| `hotel_room_suite`, `resort` | `master_bedroom`, `bedroom`, `bathroom`, `living_room`, `lobby`, `reception`, `cafe_dining`, `bar_counter`, `spa_treatment` |
| `office` | `lobby`, `reception`, `meeting_room`, `open_office`, `home_office` |
| `cafe_restaurant` | `cafe_dining`, `bar_counter`, `kitchen` |
| `retail_showroom` | `retail_floor`, `reception` |
| `spa` | `spa_treatment`, `reception`, `lobby` |
| `other` | every room |

`other` is always valid for every building use.

**InteriorStyleId**

Each style has `prompt` cues, plus a default `paletteId` and `materialPresetId`:

| id | vi | prompt | palette | preset |
|---|---|---|---|---|
| `modern` | Hiện đại | Modern, clean lines and flat planes | `cool_neutral` | `modern_clean` |
| `minimalist` | Tối giản | Minimalist, few details and generous empty space | `warm_neutral` | `minimal_light` |
| `japandi` | Japandi | Japandi, calm minimal forms and natural craftsmanship | `warm_neutral` | `japandi_natural` |
| `wabi_sabi` | Wabi-sabi | Wabi-Sabi, imperfect natural raw surfaces | `earth` | `wabi_earth` |
| `scandinavian` | Bắc Âu | Scandinavian, bright and friendly | `cool_neutral` | `scandi_light` |
| `indochine` | Đông Dương | Indochine, nostalgic tropical with Asian detailing | `earth` | `indochine_heritage` |
| `contemporary` | Đương đại | Contemporary, refined proportions and restrained contrast | `cool_neutral` | `modern_clean` |
| `luxury` | Sang trọng | Luxury, high-end finishes and precise detailing | `warm_neutral` | `luxury_stone` |
| `industrial` | Công nghiệp | Industrial, exposed structure and raw finishes | `monochrome` | `industrial_raw` |
| `tropical` | Nhiệt đới | Tropical, airy with local natural materials | `green_natural` | `tropical_craft` |
| `modern_classic` | Tân cổ điển hiện đại | Modern Classic, restrained mouldings and symmetry | `warm_neutral` | `classic_detail` |
| `neo_classic` | Tân cổ điển | Neo Classic, symmetry and pronounced mouldings | `warm_neutral` | `classic_detail` |
| `mediterranean` | Địa Trung Hải | Mediterranean, arches, warm plaster and handcraft | `blue_coastal` | `mediterranean_warm` |
| `organic_modern` | Hữu cơ hiện đại | Organic Modern, soft forms and natural materials | `warm_neutral` | `organic_soft` |
| `mid_century_modern` | Mid-century Modern | Mid-century Modern, low forms and iconic wood furniture | `earth` | `midcentury_wood` |

**PaletteId**

Each palette has `prompt` and 3–5 `swatches` (hex colours):

| id | vi | prompt |
|---|---|---|
| `warm_neutral` | Be ấm | warm beige, ivory and natural wood |
| `cool_neutral` | Xám lạnh | soft gray, white and pale wood |
| `earth` | Màu đất | terracotta, earthy brown and olive |
| `monochrome` | Đen trắng | black, white and charcoal |
| `green_natural` | Xanh rêu tự nhiên | sage green, natural wood and cream |
| `blue_coastal` | Xanh biển – cát | muted blue and sand white |

**MaterialPresetId → surfaces**

Each preset has ids for every slot below. Every preset must list a valid id for each of the 7 slots.
- `modern_clean`
- `minimal_light`
- `japandi_natural`
- `wabi_earth`
- `scandi_light`
- `indochine_heritage`
- `luxury_stone`
- `industrial_raw`
- `tropical_craft`
- `classic_detail`
- `mediterranean_warm`
- `organic_soft`
- `midcentury_wood`

**Surface slots and ids**

Each id has a `vi` label, an `en` label and a `prompt` phrase. Each also has a `swatch` hex used by the moodboard preview.
- **floor:** `oak`, `walnut`, `terrazzo`, `porcelain_tile`, `cement_tile`, `microcement`, `natural_stone`, `polished_concrete`
- **wall:** `paint`, `limewash`, `plaster`, `microcement`, `exposed_brick`, `wood_panel`, `wallpaper`, `stone_cladding`
- **ceiling:** `painted_gypsum`, `wood_slats`, `exposed_concrete`, `cove_ceiling`, `exposed_beams`
- **cabinetry:** `oak_veneer`, `walnut_veneer`, `painted_mdf`, `solid_teak`, `rattan_cane`, `lacquer`
- **countertop:** `marble`, `quartz`, `granite`, `travertine`, `terrazzo`, `solid_wood`
- **textile:** `linen`, `cotton`, `wool`, `velvet`, `leather`, `boucle`
- **metal:** `matte_black`, `brushed_brass`, `bronze`, `stainless_steel`, `chrome`

**FurnitureId**

The relevant set is suggested per room by `furnitureForRoom(roomId)`:
- `sofa`, `armchair`, `coffee_table`, `media_console`, `rug`
- `dining_table`, `dining_chairs`, `island`, `bar_stools`
- `bed`, `bedside_tables`, `wardrobe`, `dressing_table`
- `desk`, `bookshelf`
- `vanity`, `bathtub`, `walk_in_shower`
- `altar_cabinet`
- `reception_desk`, `lounge_seating`, `display_shelving`, `treatment_bed`, `meeting_table`

### 18.3 Helpers (pure, exported from `@arch/domain`)

- `INTERIOR_CATALOG`: all of the lists above.
- `roomsForUse(id)`
- `furnitureForRoom(id)`
- `styleDefaults(styleId)` returns `{ paletteId, materialPresetId }`.
- `applyStyleDefaults(interior, styleId)` sets `paletteId` and `materialPresetId`, and fills only the empty surface slots.
- `presetSurfaces(presetId)`
- `defaultInteriorDNA(use?, room?, style?)` defaults to `apartment` / `living_room` / `japandi` with the style defaults applied.
- `proposeInteriorFromLegacy(dna)` returns `{ proposal: InteriorDNA, matched: string[] }`. It maps `building.buildingType`, `architecturalStyle` and `materials` text to ids by exact case- and diacritics-insensitive match on `vi`, `en` or `id`. It never mutates.
- `interiorPromptLines(dna)` returns the compiler lines.

### 18.4 Compiler (`pc-1.4.0`)

For `projectType === "interior"` with `dna.interior`:
- The `form` section becomes `Interior space: <use.prompt> <room.prompt>.`
- The `language` section becomes `Interior style: <style.prompt>.`
- The `materials` section becomes `Materials and colors: <palette.prompt>; floor: …; walls: …; ceiling: …; cabinetry: …; countertop: …; textiles: …; metal: ….`
  - Empty slots are omitted.
  - Several ids in one slot are joined with " and ".
- A new `furnishing` section goes after materials: `Furnishing: <furniture prompts joined ", ">; <density prompt>.`
- The `lighting` section, when any of these fields is set, appends: `Interior lighting: <timeOfDay>, <daylight amount/direction>, <scenes>, warm|neutral <K> K.`
  - 2700 and 3000 K are warm, 3500 K is neutral-warm and 4000 K is neutral.
- The `camera` section, when there is no camera DNA, uses the `cameraPresetId` prompt.
- Without `dna.interior`, the compiler output is byte-identical to `pc-1.3.0`, apart from the version string.

The section order stays stable and the snapshots are updated deliberately.

### 18.5 Backend

- The DNA JSON schema is regenerated from Zod, which adds the `interior` property. `validate_dna` accepts it.
- The `roomsForUse` rule is mirrored in Rust `validate_additive_fields`. The error is at `interior.roomId`.
- There is no migration and no new command.


## 19. Master-consistent anchors (ADR-028)

### 19.1 Schema (`packages/domain/src/schemas/context.ts`)

```ts
SideTopology = "attached" | "open" | "unknown"
SiteTopology = { left: SideTopology /*default "unknown"*/, right: SideTopology /*default "unknown"*/,
                 cornerLot: boolean /*default false*/, cornerSide?: "left" | "right" }
ContextDNA.siteTopology?: SiteTopology   // optional, additive; context schemaVersion stays 1
```

Refinement: when `cornerLot === true`, `cornerSide` is required, and that side must not be `attached`.
- The error path is `context.siteTopology.cornerSide`.
- Rust mirrors the rule in `validate_additive_fields`.
- The pack `ContextPartialSchema` accepts `siteTopology`.

### 19.2 Helpers

These are pure, exported from `@arch/domain`, and live in `packages/domain/src/prompt/topology.ts`.

**`resolveSiteTopology(context)`** returns `{ left, right, cornerLot, cornerSide?, source: { left, right } }`, where each `source` value is `"explicit" | "inferred" | "default"`.
- An explicit side value other than `"unknown"` wins.
- Otherwise a side is `attached` when, after diacritic folding, any `context.<side>.adjacentBuildings` entry or its `notes` matches `/attached|party wall|lien ke|lien vach|sat vach/i`.
- Otherwise the side is `unknown`.

**`revealedSide(camera)`** returns `"left" | "right" | null`.
- For `exterior_corner` or `exterior_side`: `azimuthDeg > 0` gives `left`, `< 0` gives `right`, `0` gives `null`.
- When the azimuth is missing, fall back to a `presetId` that contains `left` or `right`.
- Every other view type gives `null`.

**`cameraSitePlan(camera, context, projectType)`** returns `{ mode, side?, reason }`, where `mode` is `"normal" | "oblique_street" | "unknown_side" | "corner_side" | "aerial_block"`.

| Condition | Mode |
|---|---|
| Interior project, or no camera | `normal` |
| Revealed side is `attached` | `oblique_street` |
| Revealed side is the confirmed `cornerSide` | `corner_side` |
| Revealed side is `unknown` | `unknown_side` |
| Revealed side is `open` | `normal` |
| `aerial`, and either side is `attached` or `density === "high"` | `aerial_block` |

### 19.3 Compiler `pc-1.5.0`

**Subject framing.** With a camera, the framing follows its `viewType`. Without a camera, the pack framing is kept unchanged.

| viewType | Framing |
|---|---|
| `exterior_front` | `exterior front view` |
| `exterior_corner` | `exterior three-quarter view` |
| `exterior_side` | `exterior side view` |
| `exterior_rear` | `exterior rear view` |
| `aerial` | `aerial architectural view` |
| `street_level` | `street-level view` |
| `detail` | `architectural detail view` |
| `interior_wide` | `wide interior view` |
| `interior_detail` | `interior detail view` |
| `custom` | `architectural view` (interior: `interior view`) |

**Master role, exterior projects.** This text replaces the current one:

```
Image N is the approved master and the source of truth for both the building and its visible site. Preserve the building's massing, floor count, roof, facade, openings, materials, and all visible surroundings: neighbouring buildings and their positions, street and sidewalk width and layout, curbs, poles, overhead wires, vegetation, vehicles, background, lighting direction, time of day, weather, and shadow character. Change only the camera viewpoint and the portions naturally revealed by that viewpoint. Do not redesign, remove, merge, relocate, or replace visible site elements.
```

**Master role, interior projects.** Keep the current text and append: `Keep the same room, window positions, view outside and lighting character.`

**Plan modes.** These apply only when a master is attached. Each mode adds lines to the preservation section; some also change the camera section and the negatives.

- **`oblique_street`**
  - The camera section ignores the stored composition and side wording. It uses the viewpoint `<front-left|front-right> oblique street view from eye level` and the composition `front facade dominant, seen at an angle along the street; the <side> side wall stays hidden behind the attached neighbour`.
  - Preservation adds:

    ```
    The building is attached to neighbouring buildings on <both sides|the <side> side>. Keep the party walls hidden and attached to the same neighbours; do not expose a side facade or side windows. Do not create a side setback, side yard, gap, passage, alley, or detached corner condition.
    ```

  - Negatives add `corner plot, street intersection, exposed side wall, side alley, side yard, detached building, side windows on party walls`.
- **`aerial_block`**
  - Preservation adds:

    ```
    Keep the same continuous mid-block street and neighbourhood shown in Image N. The subject remains between the same left and right neighbours, at the same street frontage. Extend the existing block naturally into areas outside Image N; do not create a corner lot, street junction, side street, vacant plot, new boundary, or new access road. Keep the neighbours as separate buildings and preserve their visible footprints and roof forms.
    ```

  - In the camera composition, `plot` is replaced by `same street block and surrounding rooftops`.
  - Negatives add `new street intersection, corner lot, detached neighbours, merged neighbour buildings, vacant plot`.
- **`corner_side`.** Preservation adds `This is a corner plot: a side street runs along the <side> side; reveal that side facade consistently with Image N.`
- **`unknown_side`.** Preservation adds `Do not invent a corner plot, side street or new neighbour arrangement; reveal the <side> side only as a plain continuation consistent with Image N.`

Contextual negatives are deduped and placed after the pack and DNA negatives.

**Style phrases** (`packages/domain/src/prompt/stylePhrases.ts`)
- `architecturalStyle` is matched against the table case- and diacritics-insensitively.
- A style that does not match is used as written.

| Style | Phrase |
|---|---|
| Modern tropical | Contemporary tropical residential architecture: clean rectilinear massing, deep sun-shading overhangs, operable screens, restrained tropical planting |
| Tropical minimalist | Tropical minimalist architecture: simple geometric volumes, minimal trim, shaded glazing, warm natural timber accents; no resort-style ornament |
| Bali style | Balinese tropical material palette with carved timber accents and lush planting, keeping the reference massing and openings |
| Indochine | Indochine-inspired detailing: restrained dark timber screens, patterned cement tiles, fine brass accents; no added arches or colonial facade elements |
| Neo-classical, Neo classic, Tân cổ điển | Contemporary neoclassical facade with balanced symmetry, shallow pilasters and restrained mouldings |
| Minimalist | Minimalist architecture: undecorated planes, crisp junctions, few materials, no applied ornament |
| Contemporary farmhouse | Contemporary farmhouse: simple pitched roof, board-and-batten accents, muted natural finishes |
| Modern | Modern architecture: clean lines, flat planes, large glazing, restrained material palette |
| Contemporary | Contemporary architecture: refined proportions, restrained contrast, high-quality facade finishes |
| Industrial modern | Industrial modern: exposed steel frame, standing-seam metal cladding, large factory-style glazing |
| Japandi | Japandi: calm minimal forms, natural timber, soft neutral tones, fine craftsmanship |
| Scandinavian | Scandinavian: pale timber, white walls, simple functional forms, soft daylight |
| Mediterranean | Mediterranean: warm lime plaster, natural stone, terracotta roof tiles; do not add arches unless present in the reference |

**Interior catalog `prompt` strings** are revised the same way.
- **Styles:**
  - scandinavian: `Scandinavian interior: pale oak, warm white walls, simple functional furniture, soft natural daylight, restrained black accents`
  - wabi_sabi: `Wabi-Sabi interior: muted earth tones, hand-trowelled plaster with subtle irregularity, natural stone, aged timber; refined and maintained, not damaged`
  - indochine: `Indochine interior: dark stained timber screens, patterned cement tiles, woven cane, restrained brass details; no generic Asian ornament`
  - mediterranean: `Mediterranean interior: warm lime plaster, natural stone, timber beams, handcrafted ceramics; do not add arches unless present in the room geometry`
  - The other 11 styles are reviewed for vague words.
- **Materials:** make them specific, for example:
  - wall `paint`: `smooth matte warm-white painted walls`
  - countertop `marble`: `honed white marble countertop with fine, sparse gray veining`
  - metal `stainless_steel`: `brushed stainless-steel hardware, low reflectivity`
  - Review every material id the same way.

### 19.4 Packs

- **townhouse/default, townhouse/narrow_lot, urban_villa/default**
  - `front_left_corner` and `front_right_corner` keep their ids and labels, with azimuth ±25.
  - Their composition becomes `oblique street view along the street, front facade dominant; side walls hidden by the attached neighbours`.
  - `street_level` gets `anchorRecommended: true`.
  - narrow_lot `street_level` drops "steep" and becomes a moderate oblique.
  - The two townhouse packs add `defaults.context.siteTopology { left: "attached", right: "attached" }`. Urban villa does not: it is partially attached, so it is inferred or unknown.
  - Any aerial composition says `same street block and surrounding rooftops`.
- **custom, prefab_modular, single_storey_house**
  - The aerial composition is `roof, site and immediate surroundings consistent with the master`.
  - `front` gets `anchorRecommended: true` where present.
  - Rear presets add `only where the context describes it`.
- **villa packs.** Only the rear composition wording changes, the same way.
- **interior packs**
  - `entrance_wide` uses 20 mm and `opposite_corner` uses 22 mm.
  - The `tv_wall` composition becomes "feature wall fully visible", with no sofa in the foreground.
- Bump the `packVersion` minor version of every changed pack.

### 19.5 UI

- **Bối cảnh step:** a "Vị trí lô đất" card.
  - Trái and Phải each offer Liền kề / Trống / Chưa rõ.
  - Lô góc is a checkbox with a side select.
  - Inferred values show "(tự nhận từ mô tả)" until the user sets them explicitly.
- **Camera step and anchor batch dialog:** each camera gets a chip from `cameraSitePlan`.

| Mode | Chip |
|---|---|
| `oblique_street` | "Nhìn chéo dọc phố — không lộ hông (liền kề)" |
| `aerial_block` | "Giữ nguyên dãy phố" |
| `corner_side` | "Lô góc — hiện mặt hông <bên>" |
| `unknown_side` | Warning "Góc này lộ hông <bên> chưa xác định", with buttons [Liền kề] and [Lô góc]. Each button writes `siteTopology` and autosaves. |

The batch dialog lists unresolved `unknown_side` cameras above the spend confirmation. The list is not blocking.


## 20. AI DNA assist and preset photos (ADR-030)

### 20.1 Domain (`packages/domain/src/assist/`)

```ts
AssistMode  = "brief" | "images" | "master" | "translate"
AssistScope = "interior" | "building" | "context" | "lighting"
AssistCatalog = { scope: AssistScope; fields: Array<{ path: string; kind: "id" | "ids" | "number" | "text";
                  options?: Array<{ id: string; en: string }>; min?: number; max?: number }> }
assistCatalog(scope, projectType): AssistCatalog
assistSystemPrompt(mode, catalog): string
AssistField = { path: string; value: unknown; confidence: number /*0..1*/; reason: string /*≤ 140 chars, English*/ }
AssistSuggestion = { scope: AssistScope; fields: AssistField[]; dropped: Array<{ path: string; why: string }> }
parseAssistReply(raw: string, catalog: AssistCatalog): AssistSuggestion
applyAssistFields(dna: ProjectDNA, fields: AssistField[]): ProjectDNA
```

**`assistCatalog(scope, projectType)`.** Builds the field list for a scope.
- interior: every `dna.interior` field, with the §18 catalogue ids.
- building: `floors`, `architecturalStyle` (keys of `stylePhrases` plus free text), `roof.type`, `massing.composition`, `materials`, `specialFeatures`.
- context: `density`, `siteTopology`, `front.roadType`, `front.spaceType`, `front.elements`, `vegetation`.
- lighting: `timeOfDay`, `sunDirection`, `intensity`, `ambientLight`.

**`assistSystemPrompt(mode, catalog)`.** States the role and lists the allowed ids, then:
> Answer with JSON `{fields:[{path,value,confidence,reason}]}` only. Pick only listed ids. Free text in English. Omit fields you cannot infer.

For `translate`, it asks for English translations of the given free-text paths and nothing else.

**`parseAssistReply(raw, catalog)`.** Tolerates fenced JSON. It drops a field, with the reason recorded in `dropped`, when:
- the path is unknown
- an id is not in the catalogue
- a number is out of range
- the room is invalid for the building use (§18)

It clips text.

**`applyAssistFields(dna, fields)`.** Pure. It sets the paths, then re-validates with `ProjectDNASchema`.

**`containsVietnamese(text)`.** Detects Vietnamese diacritics, for the translate prompt.

### 20.2 Backend command `dna_assist`

```
request:  { projectId, mode, scope, brief?: string (≤ 1000 chars), referenceAssetIds?: string[] (≤ 3),
            catalog: AssistCatalog, systemPrompt: string, translate?: Array<{ path, text }> }
response: { raw: string, modelId: string, usage?: { inputTokens, outputTokens }, generationId }
```

- **Mode `master`** uses the project's approved master. It fails with `INVALID_STATE` when there is none.
- **Images.** Images are read from managed files, downscaled to a 1024 px long edge as JPEG, and sent as `image_url` data URLs. The webview never sends pixels or paths.
- **Call.** `POST {HHTECH_BASE_URL}/chat/completions` with:
  - `model = HHTECH_ASSIST_MODEL` (default `gemini-3.8-flash`)
  - `response_format: {type: "json_object"}`
  - `temperature 0.2`
  - a 60 s timeout
- **Errors.** No key or base URL gives `PROVIDER_NOT_CONFIGURED`. A 401/402 or a credit message gives `PROVIDER_QUOTA` with a user hint. The key is redacted from every message.
- **Logging.** A `generations` row is recorded with `purpose = "assist"`, the provider and model, `status`, and the duration, with no outputs. Logs never contain the key, the image bytes or the full brief.
- **Mock backend.** It returns a deterministic reply per mode and scope for tests. Tests never make live calls.

### 20.3 UI

**"AI gợi ý" button.** It appears in:
- the Space step (interior)
- Kiến trúc (building)
- Bối cảnh
- Ánh sáng

Its popover offers:
- **Từ mô tả:** a textarea with an example placeholder.
- **Từ ảnh tham chiếu:** pick 1–3 reference assets, with thumbnails.
- **Từ ảnh Master:** enabled when a master is approved.

It shows the spend confirmation, using the existing threshold logic, then runs.

**Result: a diff sheet.** Each field shows the current value and the proposed value, as labels in the UI language.
- Each field has a checkbox (default on), a confidence badge and the reason.
- "Áp dụng N mục" applies the checked fields through the DNA edit path.
- Dropped fields are listed collapsed.
- On a locked or confirmed step, applying first asks to reopen that step (ADR-029: reopen does not cascade).

**Translate chip.** A free-text field containing Vietnamese shows "Dịch sang tiếng Anh cho prompt". It runs mode `translate` for that field and shows the same diff.

**MasterDnaCheck** gains "Đồng bộ DNA từ Master": mode `master`, scope `building`, then the diff sheet.

### 20.4 Preset photos

```
apps/desktop/public/previews/manifest.json
  { "version": 1, "items": { "<kind>/<id>": { "src": "previews/<kind>/<id>.webp", "w": 640, "h": 438 } } }
kinds: lighting, lighting_interior, mood, mood_interior, context, style
```

`previewPhoto(kind, id)` resolves an entry from the manifest:
- **Lighting and mood:** for interior projects, look up the `_interior` kind first.
- **Missing entry:** fall back to the SVG preview.

Images load lazily, with alt text from the preset label.


## 21. Colour grade v2 and LUT library (ADR-031)

### 21.1 Domain (`packages/domain/src/grade/`)

```ts
ColorGradeDNA += {
  highlights?, shadows?, whites?, blacks?, tint?, vibrance?, texture?, clarity?, dehaze?, vignette?, grain?: number,
  splitTone?: { shadowsHue: number /*0..360*/, shadowsSat: number /*0..100*/, highlightsHue: number, highlightsSat: number, balance: number /*-100..100*/ },
  toneCurve?: "none" | "soft_s" | "strong_s" | "faded" | "matte",
  lut?: { lutId: string, strength: number /*0..100*/ },
}
```

Numbers without their own range are -100..100. Grain is 0..100.

```ts
GRADE_STYLE_PRESETS: Record<"earthy_muted" | "heritage_warmth" | "clean_editorial" | "tropical_forest" | "concrete_steel",
  { vi, en, grade: Partial<ColorGradeDNA>, styles: string[] }>
gradePresetsForStyle(styleKey): presetId[]
isGradeV2(grade): boolean
ARCH_LUT_FILTER: { exclude: string[], prefer: string[] }
isLogLut(name): boolean
```

- **`GRADE_STYLE_PRESETS.styles`** lists the matching interior style ids (§18) and the exterior style keys (§19 `stylePhrases`).
- **`gradePresetsForStyle(styleKey)`** returns the preset ids for a style.
- **`isGradeV2(grade)`** is true when any v2 field is set.
- **`ARCH_LUT_FILTER`** holds lowercase category keywords:
  - `exclude`: `food`, `wedding`, `portrait`, `nude`, `boho`, `insta`, `men`, `rose gold`, `peach`, `royal`, `majestic`, `bright wedding`, `rover`
  - `prefer`: `aerial`, `drone`, `urban`, `city`, `landscape`, `scenery`, `natural`, `earthy`, `gray`, `kodak`, `film`, `japan`, `night`, `cinematic`, `moody`, `teal`, `travel`
- **`isLogLut(name)`** is true when the name matches `/\b(d-?log|s-?log|v-?log|log)\b/i`.

### 21.2 Backend

**Migration `0007_luts.sql`**

```sql
lut_sources(id TEXT PK, path TEXT UNIQUE, added_at TEXT, last_scan_at TEXT, lut_count INT)
luts(id TEXT PK, source_id TEXT FK, rel_path TEXT, pack TEXT, category TEXT, name TEXT, size INT,
     is_log INT, favorite INT DEFAULT 0, status TEXT /*ok|missing|invalid*/, UNIQUE(source_id, rel_path))
```

**Commands**
- `lut_source_add { path }`
  - The path must be an existing directory.
  - The scan is recursive and follows no symlinks.
  - Only `*.cube` files are indexed, at most 5,000 files, each at most 64 MB.
  - Each file is parsed for its header and validated: a 3D size of 2..65 and exactly size³ rows.
  - `pack` is the first-level folder and `category` the folder holding the file. Release-group prefixes such as `[site.com]` are stripped from both.
  - Returns `{ source, added, invalid }`.
- `lut_source_remove { sourceId }` removes the index and the cached previews, never the user files.
- `lut_source_rescan { sourceId }`
- `lut_list { query?, sourceId?, pack?, category?, favoritesOnly?, archOnly?, limit, offset }` returns `{ items, total }`.
  - `archOnly` applies `ARCH_LUT_FILTER`, mirrored in Rust.
- `lut_set_favorite { lutId, favorite }`
- `lut_preview { lutId, assetId, size? (default 256, max 512) }` returns JPEG bytes.
  - Cached at `<appData>/cache/lut_previews/<assetSha256>/<lutId>_<size>.jpg`.
  - The LUT is loaded from the stored path. A missing file gives status `missing` and the error `NOT_FOUND`.
- `grade_preview { projectId, assetId, grade: ColorGradeDNA, size? (≤ 640) }` returns JPEG bytes from the v2 engine, including the LUT.
- `grade_apply` (existing) accepts the v2 fields and a LUT, and creates a new version as today.

**Engine (`services/grade_engine.rs`)**
- Pure functions that map `ColorGradeDNA` to LightCraft settings, render, then apply the LUT.
- The only module that imports LightCraft.

**Tests**
- the mapping of each field
- neutral grade ≈ identity (mean absolute error ≤ 1/255 on a test image)
- LUT parsing: valid, wrong row count, size > 65, comments, `DOMAIN_MIN`/`DOMAIN_MAX`
- the identity LUT is a no-op
- strength blend
- the scan of a temp dir with nested packs, non-cube files ignored, and a bad cube marked invalid
- cache hits
- a missing file

The fixtures are generated in the tests, never real third-party LUTs.

**Mock backend:** an in-memory LUT index plus a placeholder preview, for UI tests.

### 21.3 UI

**Colour grade panel v2**
- Groups:
  - Ánh sáng: exposure, contrast, highlights, shadows, whites, blacks
  - Màu: temperature, tint, vibrance, saturation
  - Hiệu ứng: texture, clarity, dehaze, vignette, grain
  - Tách tông: shadow and highlight hue and saturation, balance
  - Đường cong: a tone-curve preset
- Each slider has a double-click reset.
- Live preview through `grade_preview`, debounced at 120 ms, with a before/after split.
- **Preset grid**: the existing looks plus the five style presets. Each card shows a real thumbnail from `grade_preview` at 256 px of the current asset. Presets matching the project style get a "Hợp phong cách" badge.

**Thư viện LUT** (tab inside the colour grade panel, plus a full-size dialog)
- "Thêm thư mục LUT" through the native folder dialog. Shows a scan summary.
- Grid of 256 px thumbnails from `lut_preview` on the current asset, lazy-loaded with an IntersectionObserver.
- Grouped by pack and category, with search.
- Filters: ★ favourites, and "Hợp kiến trúc" (on by default).
- Hover enlarges the thumbnail. Log LUTs show the badge "LUT cho video log — có thể gắt".
- Selecting a LUT sets `lut { lutId, strength 70 }`. The strength slider runs 0–100.
- "Áp dụng" goes through `grade_apply`.
- Manage sources: rescan, remove.
- Missing files show a "Không tìm thấy file" state.
