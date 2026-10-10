# Colour grade v2 panel + LUT library UI (ADR-031, API §21.3)

**Branch:** `wt/grade-ui`. **Agent:** Antigravity.

**You own:**
- `apps/desktop/src/features/mood/**`
- the new `apps/desktop/src/features/luts/**`
- `apps/desktop/src/lib/gradeV2.ts`, for the stand-ins
- the `grade`, `mood` and `luts` sections of `apps/desktop/src/i18n/{vi,en}.ts`
- new tests `apps/desktop/tests/gradeV2*.test.tsx` and `luts*.test.tsx`
- CSS appended in one marked block in `styles/app.css`

Do **not** touch any other file.
- `wt/assist-ui` runs in parallel and edits the lighting, Space and preview files.
- `wt/grade-core` builds the backend.
- Never touch `.env` or anything outside this worktree.

## Domain and backend stand-ins

In `lib/gradeV2.ts`, add stand-ins with the exact §21.1 shapes (`ColorGradeDNA` v2 fields, `GRADE_STYLE_PRESETS`, `gradePresetsForStyle`, `ARCH_LUT_FILTER`, `isLogLut`), marked `TODO(grade-core)`.

Call the `lut_*` and `grade_preview` commands through the services layer. In tests, stub them; do not edit `mockBackend.ts`.

## Read first

- ADR-029 (previews) and ADR-031; API §21.
- `features/mood/MoodGradePanel.tsx`, `GradeCanvas.tsx`, `features/previews/GradePreview.tsx`.
- `components/common/SpendConfirm`. Grading is local and free, so no spend confirm is needed.
- `i18n/{vi,en}.ts`.

## Scope (§21.3)

1. **Grade panel v2.**
   - The groups and sliders: range labels, double-click reset, keyboard steps.
   - Live preview via `grade_preview`, debounced at 120 ms, with stale responses ignored. Before/after split.
   - Falls back to the existing TS preview when the command is unavailable.
2. **Preset grid.**
   - Existing looks plus the five style presets.
   - Real thumbnails from `grade_preview` at 256 px.
   - A "Hợp phong cách" badge from `gradePresetsForStyle` for the project's interior style or exterior style key.
3. **Thư viện LUT** tab and full-size dialog.
   - Add a folder through the Tauri dialog, then show the scan summary.
   - Grid with lazy thumbnails (IntersectionObserver), grouped by pack and category, with search.
   - Filters: ★ favourites, and "Hợp kiến trúc" (on by default).
   - Hover enlarges the thumbnail. Log LUTs get a badge.
   - Select a LUT, then set its strength with a slider. "Áp dụng" goes through the existing apply.
   - Source manager: rescan, remove.
   - Missing-file state.
   - Paginated: about 728 LUTs must stay smooth, so request pages of 60.
4. **Strings.**
   - vi with diacritics, and en.
   - Keep i18n parity and the diacritics guard.
   - Add a test that no rendered text is a raw i18n key.
5. **Tests.**
   - Slider changes debounce into `grade_preview` calls.
   - Stale responses are ignored.
   - The preset badge appears.
   - The LUT grid paginates.
   - The architecture filter is on by default.
   - The log badge renders.
   - Strength changes the `lut` field.
   - Remove source asks for confirmation.
   - The missing state renders.

## Done when

- `npm run verify` is green.
- `npx prettier --check .` is clean.
- `docs/agent-notes/grade-ui.md` is written and lists the stand-ins.
- Do not commit; the lead commits.
