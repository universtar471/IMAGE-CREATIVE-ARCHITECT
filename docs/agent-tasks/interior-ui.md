# Interior DNA — UI (ADR-027, API §18)

**Branch:** `wt/interior-ui`. You own `apps/desktop/src/**` and `apps/desktop/tests/**`, except `tests/fixtures/backend`.

## Domain stand-ins

The domain catalog, schema and helpers are being built in parallel on `wt/interior-domain`. Until they land:
- Create `apps/desktop/src/lib/interior.ts`.
- Use exactly the §18 ids, shapes and helper signatures.
- Include a compact catalog subset: every id, each with `vi` and `en` labels. Prompt phrases are optional.
- Mark everything `TODO(interior-domain)`.

The integrator will swap the stand-ins for `@arch/domain` exports. Keep your imports in one place, so the swap is a single-file change.

## Read first

- ADR-022 (guided steps), ADR-027 and API §18.
- `features/projects/NewProjectWizard.tsx`.
- `features/dna/*` (`BuildingDnaPanel`, `ContextDnaPanel`, `DnaFields`), `features/lighting`, `features/camera`.
- `features/workflow/StepFrame.tsx`, `lib/workflow.ts`.
- `features/overview/OverviewPanel.tsx`.
- `i18n/{vi,en}.ts`.

## Scope

### 1. Wizard

For `projectType` `interior`, the architecture step asks for:
- **Loại công trình:** building use select.
- **Không gian:** room select, filtered by `roomsForUse`.
- **Phong cách:** style select.

The created DNA has `interior` from `defaultInteriorDNA` plus `applyStyleDefaults`.

### 2. Step 1 for interior projects

- Rename the step "Không gian" in vi and "Space" in en. Workflow step ids do not change; only the label and the panel do.
- The step hides the building massing, roof and facade fields and shows, in order:
  - building use
  - room, cascading: changing the use resets an invalid room to `other`, or to the first valid room
  - style. Choosing a style applies the defaults. If surfaces were already edited, show a confirm "Áp dụng bộ vật liệu của phong cách?"
  - palette
  - material preset
  - per-surface multi-selects for the 7 slots
  - furniture multi-select, suggested by `furnitureForRoom`
  - furnishing density
  - area and ceiling height (optional)
- Autosave goes through the normal DNA path.

### 3. Moodboard preview

Next to the step 1 fields:
- palette swatches
- one swatch tile per selected surface material, labelled in the UI language
- the style name

It updates live.

### 4. Other steps for interior projects

- **Bối cảnh:** show only window, view and daylight framing: daylight direction and amount. Hide the exterior site directions.
- **Ánh sáng:** add time of day, artificial scenes (chips), and colour temperature as a 4-option segmented control.
- **Góc máy:** offer the 4 interior camera presets as quick-add, with defaults of 1.35 m height and a 20 mm lens; the detail preset uses 35 mm.

### 5. Legacy projects

When an interior project without `dna.interior` opens step 1, show a callout. It offers "Chuyển sang danh sách chọn" using `proposeInteriorFromLegacy`, and lists the matched fields. Nothing is written until the user confirms.

### 6. Overview

The DNA summary for interior shows use · room · style · palette, plus a mini moodboard.

### 7. Strings

- vi with proper diacritics, and en.
- Keep i18n parity and the diacritics guard. Take catalog labels from the catalog (`vi`/`en` by locale), not from i18n.

### 8. Tests

- the wizard creates interior DNA
- the cascade resets an invalid room
- style defaults with the confirm when surfaces were edited
- the moodboard renders the swatches
- the Bối cảnh, Ánh sáng and Góc máy interior variants
- legacy proposal confirm/cancel
- non-interior projects are unchanged

## Done when

- `npm run verify` is green.
- `npx prettier --check .` is clean.
- `docs/agent-notes/interior-ui.md` is written and lists the stand-ins.
