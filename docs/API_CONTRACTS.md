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
  | "INVALID_STATE";

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
