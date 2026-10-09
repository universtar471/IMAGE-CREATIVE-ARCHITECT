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
  (an empty list means the provider decides, so the value must be `null`), `seed` set on a model without seed support, references on a
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
`provider_list` between `openai` and `local_preview`. Its models come from `HHTECH_IMAGE_MODEL`
(default `gpt-image-2`), with the GPT Image aspect ratios and no `imageSizes` (the size follows
the aspect ratio; `HHTECH_IMAGE_SIZE` without one). `configured` is false while
`HHTECH_BASE_URL` is missing or invalid, even if a key exists (`keySource` still says where the
key is). Base URL, models, size, quality and chat model are read from the environment / `.env`
only and never appear in SQLite, logs or DTOs other than the model ids.
