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

