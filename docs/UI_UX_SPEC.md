# UI / UX Architecture Specification — Phase 1 Shell

## 1. Product UX principle

UI/UX architecture is part of the product architecture and must be established during Phase 1.

However, Phase 1 should build a **functional UI shell**, not a polished final visual design.

Prioritize:
- information architecture
- navigation
- panel hierarchy
- workspace behavior
- extensibility for future modules
- professional desktop interaction

Defer:
- advanced animation
- brand polish
- visual effects
- final theme system
- extensive micro-interactions

The application should feel closer to:

**Lightroom + Figma + professional architecture software + AI production tools**

and not like a chatbot with one prompt box.

---

## 2. Primary application structure

```text
APP
│
├── PROJECT HUB
│   ├── Recent Projects
│   ├── Favorites            [future-ready]
│   ├── Archived
│   └── New Project
│
└── PROJECT WORKSPACE
    ├── Overview
    ├── Design DNA
    ├── Context
    ├── References
    ├── Camera               [future shell]
    ├── Lighting             [future shell]
    ├── Mood / Grade         [future shell]
    ├── Generate             [future shell]
    ├── Enhance              [future shell]
    ├── QC                   [future shell]
    └── Export               [future shell]
```

Phase 1 implements the functional modules:
- Overview
- Design DNA
- Context
- References
- Prompt Preview

Future modules must already have stable navigation positions but may be disabled / marked "Coming soon".

---

## 3. Project Hub

Purpose:
- open existing work quickly
- create a new project
- understand project status at a glance
- archive/restore projects

### Required Phase 1 elements

Header:
- application name
- `New Project`
- search field
- active / archived filter

Project card/list item:
- project thumbnail if available
- project name
- project type
- subtype
- project status
- updated time
- master image indicator
- open action
- archive/restore action

States:
- loading
- empty
- error
- no search result
- archived

Do not load original high-resolution images in the hub grid.

---

## 4. Project Workspace Shell

Use a persistent four-zone desktop layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ TOP BAR: Project / status / save state / key actions        │
├──────────────┬─────────────────────────────┬─────────────────┤
│              │                             │                 │
│ LEFT NAV     │        CENTER CANVAS        │ RIGHT PANEL     │
│              │                             │                 │
│ Overview     │                             │ Properties      │
│ Design DNA   │                             │ Context fields  │
│ Context      │                             │ Asset metadata  │
│ References   │                             │ etc.            │
│ ──────────   │                             │                 │
│ Camera       │                             │                 │
│ Lighting     │                             │                 │
│ Mood/Grade   │                             │                 │
│ Generate     │                             │                 │
│ Enhance      │                             │                 │
│ QC           │                             │                 │
│ Export       │                             │                 │
├──────────────┴─────────────────────────────┴─────────────────┤
│ BOTTOM TRAY: Assets | Versions | Jobs | History             │
└──────────────────────────────────────────────────────────────┘
```

### Layout rules

- Left navigation remains stable across the entire project.
- Center area is reserved as the primary visual workspace.
- Right panel shows controls/properties for the active workspace tool.
- Bottom tray is collapsible.
- Main areas should be resizable where practical, but Phase 1 can use sensible fixed defaults.
- Avoid modal-heavy workflows for routine editing.
- Keep destructive actions out of primary action positions.

---

## 5. Top Bar

Phase 1:
- back to Project Hub
- project name
- project type
- project status
- save indicator: `Saved / Saving / Error`
- archive status
- optional settings/menu

Future reserved:
- Run / Generate
- queue indicator
- provider state
- export

Do not pretend future functionality is active.

---

## 6. Left Navigation

Required order:

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

Phase 1 functional:
- Overview
- Design DNA
- Context
- References

Prompt Preview may be:
- an Overview card,
- a right-panel tool,
- or a dedicated development tab.

Choose the pattern that makes the workspace clearest, but do not disrupt future navigation hierarchy.

Future tabs:
- visible but disabled, or
- selectable with a clear "Coming in Phase N" state.

---

## 7. Center Canvas

The center canvas must be designed as a reusable long-term surface.

Phase 1 capabilities:
- empty state
- display selected image
- fit to viewport
- zoom in/out
- pan when zoomed
- reset/fit action
- show basic image dimensions
- select asset from bottom tray and display it

Future capability targets:
- before/after split
- A/B compare
- contact sheet
- masking
- brush
- rectangle/polygon selection
- click-object selection
- crop
- composition guides
- annotations
- QC overlays
- multi-view/reference display

### Important

Do not hardwire the center canvas to a single feature such as Asset Library.

Build it as a reusable `WorkspaceCanvas` / `ImageCanvas` component boundary.

Heavy image editing itself is not Phase 1.

---

## 8. Right Property Panel

The right panel should change based on active module / selection.

Examples:

### Design DNA
- building type
- style
- floors
- dimensions
- massing
- roof
- openings
- materials
- colors
- notes

### Context
- macro context
- climate
- density
- front
- rear
- left
- right
- distant background
- negative constraints

### References
When asset selected:
- preview metadata
- source
- role
- master toggle/action
- pixel dimensions
- file size
- original name

Use collapsible sections where forms become long.

Do not present hundreds of fields at once.

---

## 9. Bottom Tray

Stable future tabs:

```text
Assets
Versions
Jobs
History
```

Phase 1:
- `Assets` functional
- `Versions` may show minimal lineage or placeholder
- `Jobs` disabled / future
- `History` may be placeholder

Assets tray:
- thumbnail
- role badge
- selected state
- master badge
- import button
- multi-import
- filtering by role if practical

Selecting an asset should update:
- center canvas
- right property panel

---

## 10. New Project Wizard UX

Keep it short.

Suggested steps:

### Step 1 — Basics
- project name
- project type
- subtype

### Step 2 — Basic architecture
- style
- floors
- site/building dimensions where relevant

### Step 3 — Context starter
Use project-type-aware suggested context, not a huge mandatory form.

Examples:
- single-storey house: garden / suburban / rural
- townhouse: alley / small street / urban frontage
- urban villa: residential street / new urban area
- villa: garden / resort / lake / hill

### Step 4 — Create
Show summary and create resolved DNA.

Everything can be edited later in Workspace.

Do not make project creation require completing every DNA field.

---

## 11. Design system direction for Phase 1

Aim for:
- neutral professional surfaces
- dense enough for production work
- clear hierarchy
- strong thumbnail visibility
- low visual noise
- readable controls
- predictable spacing

Avoid:
- oversized marketing cards in workspace
- excessive gradients
- decorative glassmorphism that reduces readability
- conversational bubble UI
- large whitespace that reduces working area

Dark mode may be the initial default if convenient, but do not spend Phase 1 building a complex theme engine.

---

## 12. UX state model

Every main surface should explicitly support:

- loading
- ready
- empty
- validation error
- persistence error
- disabled/future
- archived/read-only where relevant

Saving DNA:
- optimistic UI is acceptable only if failure can be clearly surfaced and state reconciled
- otherwise debounce + save with visible status

Do not silently lose unsaved form state.

---

## 13. Responsive target

Primary target:
- Windows desktop/laptop
- 1366×768 minimum usable target
- 1920×1080 recommended

This is not a mobile-first product.

At smaller desktop sizes:
- bottom tray may collapse
- right panel may reduce width
- left nav should remain usable

---

## 14. Component boundaries

Recommended reusable components:

```text
AppShell
ProjectHub
ProjectCard
ProjectWorkspace
WorkspaceTopBar
WorkspaceNav
WorkspaceCanvas
PropertyPanel
BottomTray
AssetGrid
AssetThumbnail
ImageViewer
SectionPanel
FieldGroup
StatusBadge
EmptyState
ErrorState
FutureModulePlaceholder
PromptPreview
```

Do not put domain persistence logic inside these presentation components.

---

## 15. Phase 1 UX acceptance criteria

Phase 1 UI shell is acceptable when:

1. User launches into Project Hub.
2. User can create a project from a short wizard.
3. Opening a project enters a stable four-zone workspace.
4. Left navigation structure matches the target product.
5. Future modules are visibly reserved without pretending they work.
6. User edits Building DNA in the right/workspace properties experience.
7. User edits Context DNA without leaving the project.
8. User imports images into Assets tray.
9. Clicking an asset opens it in the center canvas.
10. Asset metadata/role appears in the right panel.
11. User can choose the master architecture image.
12. Prompt Preview is accessible without replacing the structured DNA.
13. User can return to Project Hub.
14. Close/reopen restores project state.
15. Workspace remains usable at 1366×768.
16. No major Phase 2 feature requires redesigning primary navigation.

---

## 16. What is deferred

Do not spend Phase 1 time on:
- complex transitions
- animated generation progress
- mask drawing tools
- node editor
- final branding
- cloud collaboration UI
- mobile adaptation
- advanced keyboard shortcut system
- drag-to-rearrange every panel
- final accessibility audit
- full design token/theme editor

Build the correct shell first, then polish after the workflow proves stable.
