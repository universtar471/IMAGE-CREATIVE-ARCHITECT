# Architectural Color Grading Studio V5.2 — Spec & Integration Report

**Project:** IMAGE-CREATIVE-ARCHITECT · **Date:** 2026-10-15

## Goal

Enable non-technical users to find and apply architectural post-production color grades visually, by comparing **actual grade previews of their selected project image**, rather than relying on a small text-only preset dropdown. Keep architecture, layout, details, neighbors, and alpha unchanged at the pixel-geometry level.

## Current code integration

The existing app already had six `GRADE_LOOKS`, a numeric `ColorGradeDNA` v1, local TypeScript preview (`GradeCanvas`), Tauri/Rust `grade_apply`, version tracking, and Before/After/Split tools. V5.2 **extends** these, rather than adding an AI rendering path or breaking the schema.

### Implemented in this patch

1. **30 colour looks** in the existing `GRADE_LOOKS` registry: 6 existing names retained, 24 additional looks.
2. **Bilingual metadata**: localized labels and descriptions organized into 6 categories; IDs persist unchanged in English.
3. **Live thumbnail gallery**: each thumbnail is derived from the selected *real* project asset via `assetPreview(maxEdge=384)`, downscaled to ~320px and passed through the same deterministic pixel shader as full-size preview and grade export. No generated illustrative/stock images, no AI calls.
4. **Select preset by thumbnail**: click a look, update draft `colorGrade`, rerender existing full-image `GradeCanvas` with Before/After/Split, then press **Apply** to save a new non-destructive asset version.
5. **Manual slider edits** clear `look` ID, to avoid falsely identifying a customized look as a canonical preset.
6. **Correct Exposure slider**: existing -5...5 UI was inconsistent with numeric schema (-100...100) and some preset exposures; changed to -100...100.
7. **Split comparison fix**: `CanvasRenderingContext2D.putImageData()` ignores a clip path. Use the dirty-rectangle overload to restore the left-side pixels only.
8. **Validation tests** added for 30 unique preset IDs, 6 categories, valid numeric schema, preserved alpha and unchanged original source pixels; UI test for actual image preview fetch and look selection.

### Library (30 presets)

| Group | Looks | Count |
| --- | --- | ---: |
| Natural / Realistic | Neutral, Daylight Clean, True White, Balanced Realism, Clear Architecture | 5 |
| Warm / Lifestyle | Warm Tropical, Soft Golden Hour, Warm Minimal, Amber Lifestyle, Earthy Residential | 5 |
| Cool / Modern | Cool Modern, Nordic Daylight, Steel Blue, Coastal Air, Clean Concrete | 5 |
| Editorial / Portfolio | Soft Editorial, Bright Magazine, Muted Luxury, Matte Film, Pastel Architecture, Gallery White | 6 |
| Cinematic / Dusk | Cinematic Dusk, Premium Blue Hour, Moody Contrast, Amber Dusk, Urban Noir | 5 |
| Specialized | Heritage Film, Mediterranean Sun, Forest Retreat, Premium Hotel | 4 |
| **Total** | | **30** |

### User experience

1. Select an asset in the project tray (or the active master).
2. Open **Mood / Grade**.
3. Under **Colour grade**, choose a category: All / Natural / Warm / Cool / Editorial / Cinematic / Special.
4. Compare live thumbnails of **the same project image**. Click a look.
5. View the larger image in **Before / After / Split** mode in the center area.
6. Optionally refine exposure/contrast/saturation/etc., **Apply colour grade**, creating a separate graded version.
7. For image already approved, verify material colours and highlights; use Reset to restore neutral settings.

### Data model and compatibility

- `ColorGradeDNA.schemaVersion=1` is retained. This module does not create a new schema version or alter old IDs.
- `look` remains an optional string compatible with older projects and Tauri's `ColorGrade.look`.
- The existing postprocess math (TypeScript and Rust) and `grade_apply` call are unchanged.
- New metadata are UI-only; not persisted in Project DNA.
- Geometry and scene objects do not change, since only RGB values are adjusted; alpha is preserved. However, strong colour grading **changes appearance** of material colours and light. Original image remains accessible via version history.

### Source files modified or added

```text
packages/domain/src/schemas/future.ts                extend look enum
packages/domain/src/grade/apply.ts                   24 new numeric looks
packages/domain/src/grade/catalog.ts                 NEW 30 bilingual metadata
packages/domain/src/grade/index.ts                   export metadata
packages/domain/tests/grade-catalog.test.ts          NEW data/pixel tests
apps/desktop/src/features/mood/GradeLookGallery.tsx   NEW live photo preset thumbnails
apps/desktop/src/features/mood/MoodGradePanel.tsx     gallery integration + exposure slider fix
apps/desktop/src/features/mood/GradeCanvas.tsx        split preview correction
apps/desktop/src/styles/app.css                       responsive gallery CSS
apps/desktop/src/i18n/en.ts                           strings
apps/desktop/src/i18n/vi.ts                           strings
apps/desktop/tests/p4-ui.test.ts                      UI test
```

## Unified conflict policy

| Existing state | Colour grading behavior |
| --- | --- |
| Project DNA `locks.colorGrade=true` | Look controls and Apply remain disabled |
| Lighting / Weather / Camera locked | Grading never changes these DNA sections |
| Material palette locked | Preserve material identification; warn that aggressive tints can **appear** to change original approved colour |
| Neighbor buildings / site boundaries | Pixel layout unchanged; no generative replacement |
| Enhancement & Upscale | Apply grading as a separately versioned post-process, not by merging into generative image prompts |
| Multiple project images | Same preset ID may be reused; per-image live thumbnail and material-colour review still needed |

## Follow-up work (NOT implemented)

- Full batch-apply a grade across N images with review, progress and retries.
- True 3D `.cube` LUT import/export, HDR/wide-gamut support, HSL selective grading, local contrast spatial filtering, curves and masks.
- Visual material-colour difference warnings, histograms, calibrated-display workflows.
- The 30 looks are **RGB curve adjustments** under the existing pipeline, not physically exact time-of-day lighting reconstruction. They cannot create genuine sunlight or shadow geometry, which belongs in Render Enhancement V5 / AI generation.
- Performance improvements such as thumbnail cache / web workers for exceptionally large catalogs.

## Validation and test status

- **PASS**: parsed all changed TypeScript/TSX sources with TypeScript compiler's syntax parser.
- **PASS**: consistency of all 30 look IDs across Zod enum, pixel preset library and bilingual metadata; 6 categories.
- **PASS**: executed transpiled TypeScript pixel pipeline on multiple test RGB samples, confirmed 30 distinct outputs, unchanged alpha and input buffer.
- **NOT RUN**: repository `npm test`, `npm run typecheck`, `npm run lint` and Rust test suite, because this execution environment did not have complete workspace dependencies installed; `npm install` did not finish. Run them after installing dependencies in the actual development environment.

Commands:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run test:rust
```

If Rust's grade parity fixture requires regeneration, run `npm run grade:vectors -w @arch/domain` and re-run Rust tests. Review the fixture diff before committing it.

**Installation from patch ZIP:** extract the ZIP at the **repository root**, allowing the included relative paths to overwrite existing source files. Commit on a feature branch, run the checks above, then merge after code review. The source repository ZIP is not automatically updated on GitHub.
