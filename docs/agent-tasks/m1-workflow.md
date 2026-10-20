# M1 — Quick generate, simple panel, grouped navigation (A4 + A5 + A6), ADR-039

**Branch:** `wt/m1-workflow`. You own `packages/domain/src/workflow/**`, `features/workflow/**`, `features/generate/**`, `features/workspace/modules.ts` and the left nav, and `src-tauri/src/services/generations.rs` (quick path only).

## Scope

1. **A4 Quick generate.**
   - `isGenerationAllowed(view, { mode: "quick" })` allows a hero generation when a source image (`master_architecture` or `structure_sketch`) is selected, even when the DNA steps are not confirmed.
   - Anchors and camera batches keep the full gate.
   - Rust accepts `quick` only with such a reference.
   - `validateShot` BLOCK still refuses, and the spend confirm still shows.
2. **A5 Generate panel.**
   - **Simple mode:** Source → Presets (`PresetGrid` from m1-ui) → extra prompt → Generate, with the estimated cost.
   - **Advanced mode:** provider and model, size or tier, count, references, seed, quality.
   - Smart defaults: last used provider and model, the 2K tier, 1 image, and references auto-ordered.
   - The mode is remembered in `localStorage` (wrap it in try/catch).
3. **A6 Navigation.** Group the 15 modules into Studio (Generate, Camera, Enhance), DNA (Design DNA, Context, References, Space, Site), Post (Mood/Grade, Regions, Effects, Scene objects) and Publish (Diagram, Publishing, Export). Keep the module ids and `availableIn`.
4. **Tests.**
   - Quick generate passes with unconfirmed DNA, while anchors and batches stay blocked.
   - Simple mode hides the advanced fields.
   - Navigation group order.
