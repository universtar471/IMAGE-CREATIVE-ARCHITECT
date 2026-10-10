# Visual previews for lighting, mood/grade and context (ADR-029)

**Branch:** `wt/ux-preview`.

**You own:**
- `apps/desktop/src/features/lighting/**`
- `apps/desktop/src/features/mood/**`
- `apps/desktop/src/features/dna/ContextDnaPanel.tsx`
- new `apps/desktop/src/features/previews/**`
- `apps/desktop/tests/previews*.test.tsx`
- the `lighting`, `mood`, `context` and `previews` sections of `i18n/{vi,en}.ts`
- the matching CSS, appended in a clearly marked block

Do not touch other files. `wt/ux-fix-2` runs in parallel.

Read ADR-029, ADR-028 (`siteTopology`), the lighting, mood and grade schemas and presets in `packages/domain`, and the knowledge pack presets. Read `features/lighting/LightingPanel.tsx` and `features/mood/MoodGradePanel.tsx`.

## Problem

The user cannot imagine what a preset looks like before generating: lighting presets, mood presets and colour-grade settings, and the context (Bối cảnh) fields.

## Scope

Everything here is free and local. No API calls, no new dependencies, deterministic rendering.

1. **Lighting preview**: `features/previews/LightingPreview.tsx`, an SVG scene of about 240×150 drawn from a LightingDNA.
   - Sky gradient by time of day: morning, midday, afternoon, golden hour, blue hour, night.
   - The sun or moon position follows `sunDirection` and `sunElevation`.
   - A simple house silhouette with a cast shadow whose length and softness follow the DNA.
   - Colour temperature tint, intensity and ambient level.
   - Artificial lights appear as warm window glows.

   Show it:
   - live at the top of the lighting panel
   - as a mini thumbnail (about 72×46) inside each preset option, so the presets become a visual card grid instead of a plain select
   - with hover or focus showing the larger preview
2. **Mood and grade preview**
   - Mood presets get the same SVG card style: palette swatches plus an atmosphere tint over the house silhouette.
   - The colour grade previews **live on the project's master image**, or on the selected asset when there is no master. It uses CSS filters or a canvas approximation of the grade parameters, with a before/after split slider.
   - Each grade preset shows a small thumbnail of the master with that grade applied.
   - When there is no image, fall back to the SVG scene.
   - Never write files and never call the backend for a preview.
3. **Context preview**: `features/previews/ContextPreview.tsx`, a top-down site diagram drawn from ContextDNA.
   - The lot sits in the middle.
   - Left and right neighbours are drawn attached (touching) or with a gap, following `resolveSiteTopology`.
   - A corner lot shows a side street on the confirmed side.
   - The front road is labelled with `roadType`, with a sidewalk.
   - Vegetation dots and a rear zone.
   - Density changes the number of surrounding blocks.

   Show it at the top of the Bối cảnh panel, with live updates. Each context preset option gets a mini diagram. Interior projects show a simple room-with-windows diagram instead, using the daylight direction.
4. **Accessibility**: each SVG has a `<title>` that describes it in the UI language. Previews respect dark and light themes.
5. **Tests**
   - The lighting SVG changes with time of day and sun direction (snapshot of key attributes, not pixels).
   - The preset cards render a thumbnail each.
   - The grade preview uses the master image when present and the SVG fallback when absent.
   - The context diagram for attached-both versus corner-left versus open.
   - The interior variant.
   - Snapshot of the vi and en titles.

## Done when

- `npm run verify` is green.
- `npx prettier --check .` is clean.
- `docs/agent-notes/ux-preview.md` is written.
