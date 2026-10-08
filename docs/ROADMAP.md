# Roadmap

## Phase 1 — Local core + permanent UX shell

Goal:
Establish the long-term desktop information architecture before AI integration, then implement local project/DNA/asset persistence and deterministic prompt preview.

### Phase 1A — Foundation
Deliver:
- repository scaffold
- Tauri desktop app
- React + TypeScript
- domain schemas
- SQLite migrations
- repositories/services
- Knowledge Pack seed

### Phase 1B — UI/UX Shell
Deliver:
- Project Hub
- New Project Wizard
- stable Project Workspace
- top bar
- left navigation
- reusable center Image/Workspace Canvas
- contextual right Property Panel
- collapsible bottom tray
- Assets tab
- reserved tabs for Versions / Jobs / History
- reserved future navigation for Camera / Lighting / Mood / Generate / Enhance / QC / Export
- loading / empty / error / future-module states

This is structural UX, not final visual polish.

### Phase 1C — Connect local workflow
Deliver:
- Building DNA editor
- Context DNA editor
- Asset Library
- image import
- reference roles
- master image selection
- selected asset displayed in Canvas
- asset metadata in Property Panel
- deterministic Prompt Preview
- archive/unarchive
- persistence/reopen tests

Do not connect production AI yet.

## Phase 2 — Provider-neutral AI foundation

Goal:
Introduce provider contracts, settings, generation history and one initial image provider.

Add:
- provider registry
- secure provider configuration
- model capability descriptors
- first generation adapter
- generation request persistence
- Hero image workflow
- version lineage
- history panel integration into existing bottom tray

## Phase 3 — Anchor + Camera production

Add:
- Camera DNA
- camera presets by project type
- Camera Director
- anchor view concept
- batch generation definitions
- job queue
- retries
- controlled concurrency
- Contact Sheet
- Jobs tray becomes functional

## Phase 4 — Lighting / Weather / Mood / Grade

Add:
- Lighting panel
- artificial lighting systems
- weather presets
- seasonal/tropical mood presets
- color grade controls
- lock system
- mood variations
- integrate into existing right-panel/canvas shell

## Phase 5 — Enhancement / 2K / 4K

Add:
- external enhancement provider(s)
- conservative upscale
- generative detail
- Architecture Preserve
- detail strength
- long-edge sizing
- batch enhancement
- before/after canvas comparison

## Phase 6 — Vision QC

Add:
- reference/output comparison
- geometry score
- material score
- opening/window score
- context score
- lighting score
- artifact detection
- thresholds
- retry rules
- auto-repair requests
- QC overlays in canvas

## Phase 7 — Scene Graph / Region Editing

Add:
- object IDs
- scene zones
- object relationships
- masks
- region selection
- material replacement
- selective edits
- brush / polygon / auto-select canvas tools

## Phase 8 — Automation adapters

Only after provider-based workflow is stable.

Add where permitted/appropriate:
- browser profile adapters
- session-status detection
- waiting-user states
- multi-provider routing
- Autopilot
- AI Art Director

Never make browser automation the core business logic.

## Phase 9 — Production/output ecosystem

Add:
- presentation/export presets
- social ratios
- portfolio/contact sheet templates
- recipe library
- preference profile
- cloud/project collaboration if required
- UI branding/polish once core workflow is proven
