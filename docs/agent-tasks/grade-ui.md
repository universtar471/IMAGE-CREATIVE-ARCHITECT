# Colour grade UI: V5.2/V5.3 merge + grade v2 panel + LUT library + batch (ADR-031, ADR-032, API §21.3)

**Branch:** `wt/grade-ui`. It is created from main after `wt/grade-core` merges, so the real domain v2 exports and the backend commands exist; no stand-ins are needed.

**Starting point:** the lead applies the user's V5.3 patch (18 files) with `git apply --3way` and commits it as is, including conflict markers if any. Your work starts from that commit.

**You own:**
- `apps/desktop/src/features/mood/**`
- the new `apps/desktop/src/features/luts/**`
- `packages/domain/src/grade/{apply,catalog,index}.ts`
- `packages/domain/src/schemas/future.ts` (the `look` enum only)
- the regenerated JSON schema
- the `grade`, `mood`, `moodGrade` and `luts` sections of `apps/desktop/src/i18n/{vi,en}.ts`
- tests under `apps/desktop/tests/` and `packages/domain/tests/` for these features
- CSS in one marked block in `styles/app.css`

Do not touch other files. Never touch `.env`.

## Read first

- ADR-031 and ADR-032.
- API §21.
- `docs/COLOR_GRADING_STUDIO_V5_2.md` and `V5_3.md`.
- The current `features/mood/*` and `features/previews/GradePreview.tsx`.

## Scope

1. **Resolve the V5.3 merge** against current main:
   - Keep the ADR-029 preview components.
   - Keep the grade v2 schema fields in `future.ts` and add the 24 look ids.
   - Regenerate the JSON schema with `npm run schema:export`.
   - Keep the exposure-range fix and the Split `putImageData` dirty-rectangle fix.
   - Keep "manual slider edit clears `look`".
2. **Gallery** (`GradeLookGallery`):
   - Categories: All, Natural, Warm, Cool, Editorial, Cinematic, Special (the 30 v1 looks, TypeScript thumbnails as in V5.2), plus **Hợp phong cách** (the five `GRADE_STYLE_PRESETS`) and **LUT**.
   - Style presets use real 256 px thumbnails from `grade_preview` and a "Hợp phong cách" badge when `gradePresetsForStyle` matches the project's interior style id or exterior style key.
   - Thumbnails load lazily (IntersectionObserver). A stale response must never overwrite a newer one.
3. **Grade panel v2**:
   - Slider groups per §21.3 (Ánh sáng, Màu, Hiệu ứng, Tách tông, Đường cong): range labels, double-click reset, keyboard steps.
   - Live preview: when any v2 field or `lut` is set, call `grade_preview` debounced at 120 ms and ignore stale responses. Otherwise keep the TypeScript v1 preview. Before/After/Split work in both cases.
4. **LUT library** (`features/luts/`): a tab in the gallery plus a full-size dialog, per §21.3.
   - Add a folder through the Tauri dialog and show the scan summary.
   - Pages of 60.
   - Group by pack and category; search.
   - Filters: ★ favourites, and "Hợp kiến trúc", on by default.
   - Hover enlarges the thumbnail. Log LUTs get the badge "LUT cho video log — có thể gắt".
   - Selecting a LUT sets `lut { lutId, strength: 70 }`, with a strength slider.
   - Source manager: rescan, and remove with a confirmation.
   - Missing files show "Không tìm thấy file".
5. **Batch** (`BatchGradeDialog`, `batchGrade.ts` from V5.3):
   - Accept any look, style preset or LUT grade.
   - Scale intensity per ADR-032: numeric fields go linearly toward neutral, `lut.strength` and split-tone saturations scale too, and tone curve and hues are kept.
   - Never write `draftDna.colorGrade`.
   - Disabled for read-only projects.
   - Keep stop-after-current, resume and retry-failed, and the single `asset_list` refresh.
6. **Strings:** Vietnamese with diacritics, and English. Keep i18n parity, the diacritics guard and the raw-i18n-key test green.
7. **Tests:**
   - Gallery categories, including style and LUT.
   - Slider debounce into `grade_preview`, and stale responses ignored.
   - The style badge.
   - LUT pagination, the architecture filter on by default, the log badge, and strength changing `lut`.
   - Remove source asks for confirmation; the missing state renders.
   - Batch intensity scaling for v1, v2 and LUT.
   - Batch stop, resume and retry.
   - The Split fix.

## Done when

- `npm run verify` and `npx prettier --check .` are green.
- `docs/agent-notes/grade-ui.md` is written.
- Do not commit; the lead commits.
