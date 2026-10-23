# Interior Generate — implementation report

Branch: `wt/interior-generation-flow`, based on `aa2efa7`.

## Completed

- Generate flow: Input image → Goal → Room → Style → Change level / Preserve → collapsed More options → sticky Generate image.
- Six goals, nine functional room types, compact style thumbnails (three columns at sufficient width), four change levels and five hard preserve categories.
- Indoor camera choices: original, eye level, diagonal, front, wide, detail. Source upload defaults to original camera. Camera lock names viewpoint, perspective, height, viewing direction, horizon and framing.
- Six indoor lighting choices and analysis-only style/lighting recommendations. Recommendations do not call the image-generation endpoint. Exactly three distinct catalogue styles are required; malformed/missing/unknown response values show an error with retry.
- Selective references inside Style, defaulting to style only. Color/material/layout permission conflicts are resolved explicitly. Provider reference roles and source lineage remain consistent with prompt image numbering.
- Region material controls remain behind region selection. AI can classify its surface, and the material catalogue can be filtered by surface. Existing mask generation and outside-region compositing remain in place.
- Result shortcuts: Region edit, Create variation, Increase realism, Change lighting, Upscale, Return to source, Before/After. Shortcuts prepare or open tools; the user still starts the generation.
- Existing Prompt/Node source and instruction actions synchronize with the new structured state. Legacy DNA, inactive shot choices, assets, Node graph, history and Camera Director data are retained.

## State and prompt architecture

`ShotIntent.interiorGeneration` is optional and additive. Schema version 1 stores input asset/type, goal, room, style, level, preserve flags, camera, lighting, selected reference permissions, instruction and optional source observations. Existing project storage and Rust snapshot serialization carry it; no database migration is needed.

The pipeline is preset config → structured selections → conflict resolver → pure composer → existing provider adapter → existing generation API. The composer emits System Base, Source Image Analysis, Goal, Room, Style, Change Level, Hard Locks, Camera, Lighting, Reference Attributes, User Instruction, Quality and a separate negative/protection field. Adapters already fold the negative field for providers without native negative prompts.

Hard locks win over explicit instructions; explicit instructions win over goals and stylistic defaults. A conflicting sentence is displayed and must be resolved. “Keep lock” removes that displayed sentence or reference permission only after the explicit click. Changing a source clears observations from the previous image.

## New files

- `packages/domain/src/generationPresets/`: schema, goals, rooms, styles, change-level, preserve, camera, lighting, transitions, conflicts, composer, recommendations, public index.
- `apps/desktop/src/features/generate/interior/`: `useInteriorGeneration`, form adapter, `GenerationIcon`, `GenerationChoices`, `InteriorGenerateFlow`, `InteriorSourceInput`, `InteriorStylePicker`, `InteriorReference`, `InteriorRecommendation`, `InteriorResultActions`.
- `apps/desktop/src/styles/interior-generation.css`.
- `packages/domain/tests/interior-generation.test.ts`, `interior-recommendations.test.ts`.
- `apps/desktop/tests/interiorWorkflow.test.tsx`.
- `tools/qa/interior-generation.mjs`.
- This report and `docs/agent-notes/interior-generation-flow.md`.

## Modified files and components

- Domain: `validation/shotIntent.ts`, `prompt/compiler.ts`, `assist/index.ts`, root public exports.
- Desktop integration: `app/store.ts`, `app/services.ts`, `lib/shotIntentStorage.ts`, `lib/mockBackend.ts`, `main.tsx`.
- Generate: `GeneratePanel` reuses one provider/settings/footer/result implementation for both modes; `GenerationResult` adds interior shortcuts; `extraPrompt.ts` avoids duplicate instruction composition.
- Shared controls: `SpendConfirm` supports an analysis confirmation label; `useAssetImport` returns the imported asset id to avoid selecting stale images after cancellation; `AssistControl` sends the actual region source first.
- Existing panels: `InteriorDnaPanel` releases reference ownership; `StylePanel` hosts shared selective-reference/advice controls and synchronizes selection; `RoomsPanel` synchronizes explicit room selection; `RegionPanel` adds surface classification/filtering; `useSelectionActions` preserves structured choices when continuing from an image.
- Vietnamese/English dictionaries and tests for the intentional Space/Style/Generate navigation changes.
- Rust: `providers/text.rs` adds request-only reference hints; `services/generations.rs` preserves source lineage and remaps roles without editing asset data. Tests cover the provider/history round trip.
- `docs/DECISIONS.md` records ADR-051.

## Icons

All requested goal, room, change-level, preserve, camera and lighting icon ids map to the existing Lucide SVG library. AI actions share Sparkles. No raster icons, emoji or new icon dependency were introduced by the workflow.

## Verification and remaining limits

See the task handoff note for final command results and counts. Browser QA uses isolated mock data, verifies sticky Generate and a three-column style grid at 1280×720, 1440×1000 and 1920×1080, resolves a sofa conflict, requests analysis without generation, then generates with source/reference ordering and continues from the result.

No requested P0/P1 workflow item is intentionally deferred. Automated checks do not establish the quality of a live AI model’s style/surface recognition or exact visual preservation. Source observations are recommendations, not verified measurements. Conflict detection recognizes supported Vietnamese/English phrases and typed selections; it is not a complete natural-language parser. The existing large application chunk warning remains.
