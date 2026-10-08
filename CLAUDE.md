# CLAUDE.md — AI Architecture Image Studio

## 0. Purpose

Build a desktop application for producing consistent architectural image sets from structured architectural data, references, imported images, and AI providers.

The product is NOT a generic prompt-to-image app.

The core product asset is the structured project model:

- Building DNA
- Context DNA
- Scene Graph
- Camera DNA
- Lighting DNA
- Weather / Mood DNA
- Color Grade DNA
- Asset / Reference roles
- Lock state
- Version history
- Jobs / QC / export metadata

AI models are replaceable providers. Project data must never depend on a single AI provider.

## 1. Read before coding

Before making changes, read:

1. `docs/ARCHITECTURE.md`
2. `docs/DATA_MODEL.md`
3. `docs/API_CONTRACTS.md`
4. `docs/UI_UX_SPEC.md`
5. `docs/ROADMAP.md`
6. the active file in `tasks/`

If documents conflict, use this priority:

`CLAUDE.md` > active task > architecture docs > existing implementation.

If implementation forces a design change, document it in `docs/DECISIONS.md` before broad refactoring.

## 2. Current implementation scope

Implement **Phase 1 only** unless the user explicitly asks to advance phases.

Phase 1 goal:

> Establish the permanent desktop UX shell, then create/open a local project, edit structured DNA, import external images, classify reference roles, choose a master image, persist everything to SQLite, and compile a deterministic prompt preview.

UI/UX architecture is part of Phase 1. Build the information architecture and reusable workspace shell early; defer final visual polish.

Do NOT implement yet:

- production AI provider calls
- browser automation
- automatic account login
- scraping
- image generation
- image-to-image editing
- ComfyUI integration
- Topaz / Stability integration
- camera multi-view generation
- background job workers
- auto-QC / auto-repair
- cloud sync

Design extension points for them, but do not prematurely build them.

## 3. Technical direction

Use current stable releases at implementation time.

Desktop:
- Tauri 2.x
- React
- TypeScript
- Vite

Validation/domain schemas:
- Zod is the runtime schema source of truth.
- TypeScript types are inferred from Zod where possible.
- AI structured-output JSON Schema may later be exported from the same domain schemas.

Persistence:
- SQLite
- database access belongs behind the Tauri/backend repository layer
- frontend components must not directly execute SQL
- use migrations from the first commit

Imaging:
- preserve original imported files
- derived assets are always separate records/files
- never overwrite the original image

Future AI worker:
- Python service/process is allowed later for computer vision, segmentation, depth, ComfyUI, local AI and batch imaging
- Phase 1 should not require Python to launch the desktop application

## 4. Architectural boundaries

Keep these responsibilities separate:

### Domain
Pure data types, validation, invariants and deterministic transformations.

### Persistence
SQLite repositories and migrations.

### Application services
Use cases such as create project, import asset, set master, update DNA and compile prompt.

### Desktop bridge
Tauri commands/events only.

### UI
React components, local view state and calls to typed application commands.

### Providers
Future AI/model/browser adapters. They must depend on domain contracts, never the reverse.

Dependencies should generally point inward:

UI -> application -> domain
Persistence -> domain
Providers -> domain
Tauri bridge -> application

Domain must not import React, Tauri, SQL, provider SDKs or browser automation packages.

## 5. Critical design rules

1. **Structured DNA is source of truth. Prompt text is derived output.**
2. **Provider-neutral core.** Never place Gemini/OpenAI/Claude-specific fields in core DNA.
3. **Original assets are immutable.**
4. **Every derived image must have lineage:** parent asset/version + operation metadata.
5. **Reference role matters.** Architecture, material, landscape, lighting, mood and camera references are not interchangeable.
6. **No plaintext passwords or session cookies in the database.**
7. **No hidden destructive behavior.** Deleting a project/asset must require an explicit UI action and safe confirmation.
8. **Migrations must be additive/reversible where practical.**
9. **All external IDs exposed across UI/backend should be stable IDs, not SQLite row numbers.**
10. **All DNA updates are validated before persistence.**
11. **Prompt Compiler must be deterministic for identical input + compiler version.**
12. **No giant god-service.** Keep use cases small and testable.

## 6. Stable ID strategy

Use ULID strings for application entities:

- `PRJ_<ulid>`
- `AST_<ulid>`
- `VER_<ulid>`
- `OBJ_<ulid>`
- `CAM_<ulid>`
- `JOB_<ulid>`
- `MAT_<ulid>`

DB integer primary keys are optional internally, but business relationships must use stable IDs.

## 7. Project states

Supported target states:

- `draft`
- `dna_ready`
- `concepting`
- `master_pending`
- `master_approved`
- `anchor_generation`
- `design_locked`
- `production`
- `qc`
- `final`
- `archived`

Phase 1 primarily uses:

- `draft`
- `dna_ready`
- `master_pending`
- `master_approved`
- `archived`

Do not permit impossible transitions silently.

## 8. Asset roles

Supported reference roles:

- `master_architecture`
- `architecture_reference`
- `material_reference`
- `context_reference`
- `landscape_reference`
- `lighting_reference`
- `mood_reference`
- `camera_reference`
- `regular_image`

One project may have many references but at most one active `master_architecture` asset in Phase 1.

## 9. Project type taxonomy

Initial project types:

- `interior`
- `townhouse`
- `single_storey_house`
- `villa`
- `urban_villa`
- `prefab_modular`
- `cafe`
- `restaurant`
- `hotel`
- `office`
- `commercial`
- `resort`
- `custom`

Do not hardcode all architectural knowledge into React components. Project-type knowledge belongs in data-driven Knowledge Packs.

## 10. Knowledge Packs

Target path:

`knowledge/<project_type>/<subtype>/`

A pack can later contain:

- `building_rules.json`
- `context_rules.json`
- `materials.json`
- `camera_presets.json`
- `lighting_presets.json`
- `negative_constraints.json`
- `common_errors.json`
- `prompt_templates.json`

For Phase 1 create a minimal loader and seed packs only for:

- townhouse
- single-storey house
- villa
- urban villa
- prefab/modular
- interior

Fallback safely to `custom`.

Knowledge Packs are configuration, not executable code.

## 11. Prompt Compiler

Implement a provider-neutral compiler interface.

Input:
- project metadata
- validated DNA
- reference roles
- lock state
- optional Knowledge Pack

Output `PromptBundle`:
- `positivePrompt`
- `negativePrompt`
- `referenceInstructions`
- `preservationInstructions`
- `metadata`
- `compilerVersion`

The compiler must not call an LLM in Phase 1.

It should create a deterministic readable prompt preview from structured values.

## 12. UI / UX architecture

Treat `docs/UI_UX_SPEC.md` as a required Phase 1 product architecture document.

Phase 1 must establish these permanent surfaces:

1. Project Hub
2. New Project Wizard
3. Project Workspace Shell
4. Left module navigation
5. Center reusable Image/Workspace Canvas
6. Right contextual Property Panel
7. Bottom Asset/Version/Jobs/History tray

The intended workspace is:

```text
LEFT NAV | CENTER CANVAS | RIGHT PROPERTIES
-------------------------------------------
       BOTTOM ASSET / VERSION TRAY
```

Functional in Phase 1:
- Overview
- Design DNA
- Context
- References / Assets
- Prompt Preview

Reserved future navigation:
- Camera
- Lighting
- Mood / Grade
- Generate
- Enhance
- QC
- Export

Future modules may be disabled or show a clear placeholder. Do not hide them and later redesign the primary navigation.

The UI should feel like a professional production tool, not a chatbot-first experience.

Phase 1 is **UX shell first, polish later**:
- implement layout, states, navigation, selection behavior and reusable component boundaries now
- defer sophisticated animation, branding, final themes and micro-interactions

## 13. Required engineering quality

Before marking a task complete:

- TypeScript typecheck passes
- frontend lint passes
- unit tests pass
- Rust/Tauri build/check passes
- DB migrations apply on a fresh database
- DB can reopen existing data
- no secrets are committed
- no ignored runtime output is accidentally committed

Add tests for domain invariants and prompt compiler behavior.

Prefer small focused tests to broad snapshot-only testing.

## 14. Error handling

User-facing errors should be actionable.

Examples:
- unsupported image -> explain supported formats
- asset copy failed -> keep DB unchanged
- invalid DNA -> report field errors
- migration failed -> do not continue with partial schema
- missing project files -> show recovery state, do not silently delete DB records

Never swallow exceptions silently.

## 15. File storage

Default local project storage concept:

`<app-data>/projects/<project_id>/`

Subfolders:
- `assets/original/`
- `assets/derived/`
- `previews/`
- `exports/`

DB stores relative managed paths where possible.

Imported original filenames may be retained as metadata but should not be trusted as unique identifiers.

Use collision-safe generated filenames.

## 16. Git / Claude Code behavior

- Do not push or publish unless the user explicitly asks.
- Do not rewrite git history.
- Do not run destructive filesystem commands unless required and clearly safe.
- Prefer inspect -> plan -> implement -> test.
- For multi-file changes, keep the change scoped to the active task.
- Update `docs/PROGRESS.md` after a meaningful completed milestone.
- Record non-trivial architecture changes in `docs/DECISIONS.md`.

## 17. Phase 1 completion definition

Phase 1 is complete only when the following works end-to-end:

1. Launch desktop app into Project Hub.
2. Create a new project through the short wizard.
3. Enter the stable Project Workspace shell.
4. Verify left navigation, center canvas, right property panel and bottom tray.
5. Choose project type/subtype.
6. Edit Building DNA.
7. Edit Context DNA.
8. Save and close app.
9. Reopen and recover identical project data.
10. Import multiple external images.
11. Assign each an Asset Role.
12. Select exactly one master architecture image.
13. Select an asset and view it in the center canvas with metadata in the right panel.
14. Compile and display deterministic prompt preview.
15. Archive/unarchive project safely.
16. Verify future module navigation exists without active backends.
17. All acceptance tests in `tasks/PHASE_01.md` pass.

Stop after Phase 1 and report:
- files changed
- tests/build status
- unresolved issues
- recommended Phase 2 starting point

Do not begin Phase 2 automatically.
