# Architecture

## 1. Product model

AI Architecture Image Studio is built around a provider-neutral architectural scene description.

The application should eventually support:

Text / structured input
-> Project DNA
-> Context + Scene
-> Camera / Lighting / Mood
-> Prompt Compiler
-> Provider Router
-> Generate / Edit
-> Asset Library
-> QC
-> Enhance / Upscale
-> Version Tree
-> Export

Phase 1 stops before real provider calls.

## 2. Target repository layout

```text
arch-ai-studio/
├─ CLAUDE.md
├─ apps/
│  └─ desktop/
│     ├─ src/
│     │  ├─ app/
│     │  ├─ components/
│     │  │  ├─ shell/
│     │  │  ├─ canvas/
│     │  │  ├─ panels/
│     │  │  └─ common/
│     │  ├─ features/
│     │  │  ├─ projects/
│     │  │  ├─ workspace/
│     │  │  ├─ dna/
│     │  │  ├─ assets/
│     │  │  └─ prompt-preview/
│     │  ├─ lib/
│     │  └─ types/
│     └─ src-tauri/
│        ├─ src/
│        │  ├─ commands/
│        │  ├─ db/
│        │  ├─ repositories/
│        │  ├─ services/
│        │  └─ storage/
│        └─ migrations/
├─ packages/
│  ├─ domain/
│  │  └─ src/
│  │     ├─ schemas/
│  │     ├─ entities/
│  │     ├─ prompt/
│  │     └─ invariants/
│  └─ knowledge/
│     └─ src/
├─ knowledge/
│  ├─ interior/
│  ├─ townhouse/
│  ├─ single_storey_house/
│  ├─ villa/
│  ├─ urban_villa/
│  └─ prefab_modular/
├─ docs/
└─ tasks/
```

Claude may adjust exact workspace tooling if needed, but preserve the domain/application/provider boundaries.


## 3. UI/UX shell architecture

The primary UI shell is a stable product-level boundary and should be implemented during Phase 1.

```text
Project Hub
    |
    v
Project Workspace
+------------------------------------------------------------+
| Top Bar                                                    |
+------------+-------------------------------+---------------+
| Left Nav   | Center Workspace Canvas       | Right Panel   |
|            |                               |               |
+------------+-------------------------------+---------------+
| Bottom Tray: Assets | Versions | Jobs | History           |
+------------------------------------------------------------+
```

Responsibilities:

### Project Hub
Project discovery, create/open, archive/restore, status overview.

### Left Nav
Stable module information architecture. Functional and future modules keep fixed positions.

### Center Workspace Canvas
Reusable visual surface for image viewing now and future compare/mask/QC workflows.

### Right Property Panel
Contextual controls for the active module or selected asset.

### Bottom Tray
Persistent production context: assets first in Phase 1; versions/jobs/history expand later.

See `docs/UI_UX_SPEC.md` for required behaviors and acceptance criteria.

The shell must not directly contain domain persistence logic. It consumes feature/application services through typed boundaries.


## 4. Core domain aggregates

### Project

Owns:
- identity
- name
- type/subtype
- status
- active master asset ID
- DNA aggregate
- lock state
- created/updated timestamps

### ProjectDNA

Contains:
- BuildingDNA
- ContextDNA
- optional CameraDNA
- optional LightingDNA
- optional WeatherDNA
- optional MoodDNA
- optional ColorGradeDNA

Phase 1 UI edits BuildingDNA and ContextDNA. Other schemas should exist in target design but may remain minimally implemented.

### Asset

Represents every managed image/file.

Important distinction:
- source = where the file came from
- role = how the project uses it
- status = workflow state
- lineage = what produced it

### Version

Represents a derived visual branch. Phase 1 may create the schema but does not need full visual tree UI.

## 5. Domain invariants

- Project name cannot be empty.
- Project type must be in known taxonomy or `custom`.
- Building floors must be positive when defined.
- Dimensions cannot be negative.
- Context density uses constrained enum values.
- Exactly zero or one active master architecture asset per project in Phase 1.
- Master asset must belong to the same project.
- Asset original file is immutable after successful import.
- Archived project is read-only for production operations until restored.
- DNA JSON stored in DB must validate against current compatible schema.
- Every entity has `created_at` and `updated_at`.
- All prompt output includes compiler version.

## 6. Knowledge architecture

Knowledge Packs are read-only configuration bundles bundled with the app during Phase 1.

A pack may contribute:
- default DNA
- select options
- project-specific negative constraints
- common context presets
- future camera/lighting presets
- prompt vocabulary

Knowledge Pack values are suggestions/defaults, not authoritative replacements for user input.

Project saved data must remain valid even if the Knowledge Pack changes in a future version.

Therefore persist resolved user DNA, not merely "preset X".

## 7. Prompt compilation

Pipeline:

```text
Validated Project
+ Knowledge Pack
+ DNA
+ References
+ Locks
      |
      v
Normalize
      |
      v
Prompt Sections
      |
      v
PromptBundle
```

Prompt sections should be explicit:

1. project identity
2. architectural type
3. building form
4. architectural language
5. materials/colors
6. context
7. camera (future)
8. lighting/weather/mood (future)
9. reference-role instructions
10. preservation/lock instructions
11. negative constraints

Do not build one giant template string with many conditionals in a React component.

## 8. Future provider boundary

Target interface concept:

```ts
interface GenerationProvider {
  capabilities(): ProviderCapabilities;
  generate(request: GenerationRequest): Promise<GenerationResult>;
}

interface EditProvider {
  edit(request: EditRequest): Promise<EditResult>;
}

interface VisionProvider {
  analyze(request: VisionRequest): Promise<VisionResult>;
}

interface UpscaleProvider {
  upscale(request: UpscaleRequest): Promise<UpscaleResult>;
}
```

The core domain must not know vendor SDK request shapes.

## 9. Future job engine

Target lifecycle:

`queued -> preparing -> running -> downloading -> verifying -> qc -> completed`

Exceptional:
- failed
- retrying
- waiting_user
- cancelled

The jobs table exists in the long-term schema, but Phase 1 does not need workers.

## 10. Security boundary

Future browser/provider secrets must live outside ordinary SQLite project data.

Never persist:
- account passwords
- raw auth cookies
- raw browser session tokens
- API keys in project JSON

Future secrets should use operating-system secure storage/keychain when possible.

## 11. Image integrity strategy

Import flow must be transactional at application level:

1. validate source file
2. compute metadata/hash
3. copy to managed original folder
4. verify copied file exists
5. write DB record
6. create thumbnail/preview if implemented
7. return Asset

If copy fails, do not write a successful asset record.
If DB write fails after copy, clean up orphaned managed copy when safe.

## 12. Performance

Phase 1:
- lazy-load project thumbnails where practical
- do not load full 4K images into grids
- store dimensions/hash/size at import time
- keep React lists keyed by stable IDs

Future:
- thumbnail cache
- job concurrency control
- image tile/preview strategy
