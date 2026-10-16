# UI wizard — theme-first short project wizard (ADR-039)

**Branch:** `wt/ui-wizard`.

## Read first
- ADR-039 and ADR-034 amendment 2 in `docs/DECISIONS.md`.
- `apps/desktop/src/features/projects/NewProjectWizard.tsx` and its tests.
- `apps/desktop/src/lib/interior.ts`, `packages/domain/src/interior/catalog.ts`, `apps/desktop/src/lib/knowledge.ts`.
- The i18n dictionaries under `apps/desktop/src/i18n/`.

## Scope
1. **Step 1 "Cơ bản".** Name field plus two large selectable cards, "Công trình" and "Nội thất", each with an icon (lucide) and a one-line description. Keyboard accessible (radio group semantics). No other fields.
2. **Step 2 "Phân loại", loaded from the theme.**
   - Công trình: building-type cards for `townhouse`, `single_storey_house`, `villa`, `urban_villa`, `prefab_modular`, `hotel`, `resort`, `custom`. Below, the subtype select from `knowledge.listSubtypes`, then the optional style.
   - Nội thất: building use, room filtered by `roomsForUse`, interior style (the existing interior step).
   - Switching theme resets the step-2 choices to that theme's defaults.
   - A collapsed "Thông số (tùy chọn)" section holds floors, building width and depth, site width and depth (Công trình only) and the context preset picker. Validation errors as today.
   - The DNA preview the old step 4 showed moves into a small summary on step 2.
3. **Create from step 2.** The primary button "Tạo dự án" is on step 2. Remove the old steps 3 and 4. Created DNA must equal what the old wizard produced for the same inputs (same `createInitialDNA` / `applyStyleDefaults` calls).
4. **Strings** in Vietnamese with full diacritics and in English. Remove keys that become unused.

## Tests
- Step 1 requires a name and a theme; the theme cards toggle.
- Công trình shows exactly the eight types; `cafe`, `restaurant`, `office`, `commercial` are absent.
- Nội thất creates a project with `projectType: "interior"` and the chosen room and style.
- Switching theme resets step-2 values.
- Create works without opening "Thông số"; the pack defaults apply.
- With the optional section filled, the created DNA matches the old wizard output for the same inputs.

## Out of scope
- Schema, Rust, compiler, validator, workspace navigation (UI-1), generate screen (UI-3).

## Done when
- `npm run verify` and `npx prettier --check .` pass.
- `docs/agent-notes/ui-wizard.md` is written.
- Do not commit. Do not touch `.env`. Make no paid calls.
