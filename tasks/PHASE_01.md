# PHASE 01 — Local Core + UI/UX Shell

## Objective

Build the permanent desktop information architecture and a stable local project foundation before any real AI integration.

Phase 1 is split into:

- **1A Foundation**
- **1B UI/UX Shell**
- **1C Connected local workflow**

Do not spend this phase on final visual polish. Build the correct shell, interaction structure and persistence.

---

## P1-01 Repository scaffold

- [ ] create workspace structure
- [ ] Tauri 2 + React + TypeScript app starts
- [ ] add domain package
- [ ] add docs/tasks to repo
- [ ] configure formatting/lint/typecheck
- [ ] add test runner
- [ ] `.gitignore` runtime/app-data output

Acceptance:
- app launches
- typecheck/lint/test/check commands are documented and pass

---

## P1-02 Domain schemas

- [ ] ProjectType
- [ ] ProjectStatus
- [ ] AssetRole
- [ ] AssetSource
- [ ] BuildingDNA
- [ ] ContextDNA
- [ ] future minimal DNA schemas
- [ ] ProjectDNA
- [ ] PromptBundle
- [ ] unit tests for invalid values/defaults

Acceptance:
- schemas import without UI/Tauri dependencies
- TypeScript types derive from runtime schemas where possible

---

## P1-03 SQLite + migrations

- [ ] database bootstrap
- [ ] schema_migrations
- [ ] projects
- [ ] project_dna
- [ ] assets
- [ ] versions
- [ ] repository layer
- [ ] fresh-db migration test
- [ ] reopen existing-db test

---

## P1-04 Knowledge Pack loader

Seed:
- townhouse
- single-storey house
- villa
- urban villa
- prefab/modular
- interior

Each minimal pack:
- defaults
- context suggestions
- negative constraints
- pack version

Acceptance:
- unknown/missing subtype safely falls back
- saved project does not depend on pack remaining unchanged

---

## P1-05 Project application services

Implement:
- create
- list
- get
- update metadata
- archive/unarchive

Acceptance:
- create project + default DNA is atomic
- invalid project type rejected
- archived projects remain recoverable

---

# PHASE 1B — UI/UX SHELL

## P1-06 Project Hub

Implement:
- [ ] application shell
- [ ] Project Hub route/screen
- [ ] project cards/list
- [ ] search
- [ ] active/archived filter
- [ ] create project button
- [ ] reopen project
- [ ] archive/restore action
- [ ] loading state
- [ ] empty state
- [ ] error state

Project item shows:
- thumbnail when available
- name
- project type/subtype
- status
- updated time
- master image indicator

Acceptance:
- app opens to Project Hub
- no full-resolution images are loaded for hub thumbnails

---

## P1-07 Project Workspace Shell

Implement the permanent four-zone layout:

```text
TOP BAR
LEFT NAV | CENTER CANVAS | RIGHT PROPERTY PANEL
BOTTOM TRAY
```

Required:
- [ ] WorkspaceTopBar
- [ ] WorkspaceNav
- [ ] WorkspaceCanvas
- [ ] PropertyPanel
- [ ] BottomTray

Left navigation order:

```text
Overview
Design DNA
Context
References
──────────
Camera
Lighting
Mood / Grade
──────────
Generate
Enhance
QC
Export
```

Functional Phase 1:
- Overview
- Design DNA
- Context
- References

Future modules:
- visible but disabled, or
- display an explicit Future Module placeholder

Bottom tray:
- Assets functional later in Phase 1
- Versions reserved
- Jobs reserved
- History reserved

Acceptance:
- primary navigation should not need redesign for Phase 2–7
- layout usable at 1366×768
- shell is not chatbot-centric

---

## P1-08 Reusable Image Canvas

Implement only lightweight Phase 1 viewing tools:

- [ ] empty state
- [ ] display selected image
- [ ] fit to viewport
- [ ] zoom in/out
- [ ] pan when zoomed
- [ ] reset/fit action
- [ ] show basic image dimensions

Architecture:
- keep canvas reusable
- do not couple it to Asset Library persistence
- reserve future capability for compare/mask/crop/QC

Acceptance:
- selected asset can be shown without loading every project image at full resolution

---

## P1-09 New Project Wizard

Keep wizard intentionally short.

Fields:
- project name
- project type
- subtype
- optional style
- optional floors
- optional initial site/building dimensions
- simple project-type-aware context starter

On create:
- merge Knowledge Pack defaults
- persist resolved DNA
- open Project Workspace

Acceptance:
- user is not forced to complete full DNA before entering project
- created project can be edited later

---

# PHASE 1C — CONNECT LOCAL WORKFLOW

## P1-10 DNA Editor

### Building panel
- floors
- dimensions
- style
- massing
- roof
- openings
- materials descriptions
- color palette
- special features
- notes

### Context panel
- macro context
- climate
- density
- front
- rear
- left
- right
- distant background
- negative constraints

UX:
- edit inside Workspace
- use grouped/collapsible sections
- right panel or main working panel may be used consistently
- visible save state: Saved / Saving / Error

Acceptance:
- invalid numeric values never enter persisted DNA
- close/reopen returns identical valid data
- unsaved changes are not silently lost

---

## P1-11 Asset Import Service

- [ ] JPEG
- [ ] PNG
- [ ] WebP
- [ ] dimensions
- [ ] MIME
- [ ] size
- [ ] SHA-256
- [ ] managed-copy storage
- [ ] DB record
- [ ] safe rollback on failure

Never modify/delete user source file.

---

## P1-12 Asset Library + Bottom Tray

Assets tray:
- [ ] import multiple images
- [ ] thumbnail strip/grid
- [ ] selected state
- [ ] role badge
- [ ] master badge
- [ ] filter by role if practical

Asset Property Panel:
- [ ] original name
- [ ] source
- [ ] role
- [ ] dimensions
- [ ] file size
- [ ] master action
- [ ] safe remove action

Interaction:
- clicking asset -> center canvas
- clicking asset -> metadata in right Property Panel

Acceptance:
- max one master architecture image
- changing master demotes previous master to architecture reference
- duplicate binary warning based on SHA-256
- original user source file remains untouched

---

## P1-13 Prompt Compiler

Implement deterministic provider-neutral compiler.

Required sections:
- project type
- building DNA
- materials/colors
- context by direction
- negative constraints
- reference-role instructions
- preservation instructions
- compiler metadata

Tests:
- same input => same output
- missing optional fields => clean text, no `undefined`
- townhouse context differs from villa context
- master/reference roles generate distinct instructions

---

## P1-14 Prompt Preview UX

Required:
- [ ] positive prompt
- [ ] negative prompt
- [ ] reference instructions
- [ ] preservation instructions
- [ ] copy button
- [ ] compiler version

Prompt Preview may live in Overview or as a contextual panel, but must not replace structured DNA.

Do not allow compiled prompt text to become source of truth.

---

## P1-15 Workspace future-state verification

Verify reserved UI states exist for:
- Camera
- Lighting
- Mood / Grade
- Generate
- Enhance
- QC
- Export
- Versions
- Jobs
- History

Acceptance:
- future modules do not execute fake functionality
- each clearly states it is not implemented
- their future integration fits current shell without navigation redesign

---

## P1-16 Final Phase 1 verification

Manual scenario:

1. launch app into Project Hub
2. create `Villa Tropical Test`
3. select villa
4. set 2 floors
5. set colors white/beige
6. set travertine/wood/glass
7. enter stable Project Workspace
8. verify left nav + canvas + right panel + bottom tray
9. set front garden + road
10. set rear pool/garden
11. save
12. import 4 images
13. assign:
   - master architecture
   - material reference
   - mood reference
   - landscape reference
14. select each asset and verify Canvas + Property Panel update
15. close app
16. reopen
17. verify all data
18. switch master
19. verify old master demoted
20. compile prompt
21. open each future navigation item and verify safe placeholder/disabled state
22. archive
23. restore
24. verify workspace at 1366×768
25. run all automated checks

---

## Completion report format

When Phase 1 is complete, Claude should report:

### Implemented
Short list.

### UI/UX shell
- Project Hub:
- Workspace shell:
- Canvas:
- Property panel:
- Bottom tray:
- Future navigation:

### Main files/modules
Short list.

### Validation
- frontend typecheck:
- lint:
- unit tests:
- Rust/Tauri check:
- migration test:
- manual scenario:
- 1366×768 usability:

### Known limitations
Only real remaining issues.

### Phase 2 recommendation
Do not implement it until user approves.
