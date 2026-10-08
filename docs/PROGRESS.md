# Progress

## Current phase
Phase 1 — implemented on branch `wt/phase-01`; awaiting manual end-to-end check in the
real desktop window (see "Not yet verified").

## Completed
- Architecture handoff package prepared.
- UI/UX Shell specification added as a formal Phase 1 requirement.
- **P1-01 Scaffold** — npm workspaces, Tauri 2 + React 19 + TS + Vite, ESLint, Prettier,
  Vitest, cargo tests, `.gitignore` for runtime data.
- **P1-02 Domain schemas** — Zod enums, Building/Context DNA, future Camera/Lighting/
  Weather/Mood/ColorGrade, LockState, ProjectDNA, PromptBundle, DTOs; JSON Schema export.
- **P1-03 SQLite + migrations** — `0001_initial.sql` (projects, project_dna, assets,
  versions), forward-only runner, fresh-DB and reopen tests, newer-schema refusal.
- **P1-04 Knowledge Packs** — townhouse (default, narrow_lot), single-storey house, villa
  (default, tropical), urban villa, prefab/modular, interior (default, living_room),
  custom fallback; resolver with exact → type default → custom fallback.
- **P1-05 Project services** — create (atomic, folder rollback), list, get, update
  metadata, archive/restore, approve master; derived status (ADR-009).
- **P1-06 Project Hub** — cards with thumbnail/master badge/status/updated time, search,
  active/archived/all filter, archive (confirm) / restore, loading/empty/error/no-result.
- **P1-07 Workspace shell** — top bar (save state, status, archive), permanent left nav,
  center canvas with Canvas / Prompt Preview tabs, contextual right panel, collapsible
  bottom tray (Assets, Versions, Jobs, History).
- **P1-08 Image canvas** — fit, zoom buttons + wheel around cursor, pan when zoomed, 1:1,
  dimensions overlay, missing-file recovery state; only the selected original is loaded.
- **P1-09 New Project Wizard** — 4 short steps (basics, architecture, context starter,
  summary); only the name is required.
- **P1-10 DNA editor** — Building + Context panels with collapsible sections, tag lists,
  materials table, lock toggles; Zod validation per keystroke, debounced autosave,
  Saved/Unsaved/Saving/Fix-fields/Error indicator, flush on module switch, hub and window
  close.
- **P1-11 Asset import** — JPEG/PNG/WebP sniffed by content, dimensions, MIME, size,
  SHA-256, managed copy via `.part` + rename, thumbnail, root version, rollback.
- **P1-12 Asset library** — tray strip with role filter, import-as role, multi-import,
  drag & drop, duplicate prompt, property panel (metadata, role, master, safe remove).
- **P1-13 Prompt compiler** — deterministic, provider-neutral, sectioned; tests for
  determinism, order independence, clean optional output, type differences, role
  instructions.
- **P1-14 Prompt Preview** — positive/negative/reference/preservation/metadata blocks,
  copy buttons, compiler version; compiled from persisted data only.
- **P1-15 Future states** — Camera, Lighting, Mood/Grade, Generate, Enhance, QC, Export,
  Jobs, History show explicit "coming in Phase N" placeholders; Versions shows import
  lineage.

## Automated checks (last run)
- `npm run typecheck` — pass
- `npm run lint` — pass
- `npm test` — 70 tests pass (42 domain, 28 desktop)
- `cargo test` — 28 tests pass; `cargo clippy --all-targets` — 0 warnings
- `npm run build -w @arch/desktop` — pass
- `tauri dev` — app launches, database + migrations created in the data folder

## Not yet verified
- Full manual scenario P1-16 inside the native Tauri window (image import via the OS
  dialog, canvas zoom/pan on real files, close/reopen, 1366×768). UI flows were exercised
  in the browser preview with the mock backend; backend flows by cargo tests.

## Blocked
- None.

## Notes
Update this file after each meaningful milestone.
