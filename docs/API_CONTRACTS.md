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
