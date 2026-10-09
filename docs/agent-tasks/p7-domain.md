# P7-A — Domain: regions, scene objects, mask rasterisation, region-edit prompt

Branch `wt/p7-domain`. You own `packages/domain/**` only.

Read first:
- `tasks/PHASE_07.md`
- ADR-025 and API §16
- `prompt/compiler.ts` and its snapshot tests
- `schemas/projectDna.ts` (`LockState.objectIds`)
- the Phase 5 enhance code and the Phase 6 QC code, as patterns

## Scope

1. **Schemas** in `packages/domain/src/regions/`, exactly per §16.1:
   - `RegionShape`, `RegionDTO`, `SceneObject`, `RegionEditParams` (with its refinements)
   - request schemas for `region_list`, `region_save` and `region_delete`
   - Add `dna.scene` as an optional additive section. Every existing DNA must still parse.
   - `GenerationPurposeSchema` gains `"region_edit"`. `params.region` is required for that purpose.
   - Model capabilities gain `supportsMask` (default false).
   - Re-export the JSON Schema. If you hit the known sandbox `ENOMEM` error, say so in the note.
2. **`rasterizeMask` and `featherMask`**, exactly per §16.1:
   - Pixel-centre rule.
   - Polygon uses even-odd fill.
   - Brush draws discs and capsules; its radius is normalised to the long edge.
   - Feathering is a box blur run 3 times; the radius is in px.
   - Generate `packages/domain/test-vectors/masks.json` (small sizes, e.g. 16×12 and 33×20) with a script or test:
     - each shape type
     - a union
     - a concave polygon
     - a self-intersecting polygon (even-odd)
     - a brush with 2 strokes
     - feathering
   - Add a test that regenerates the vectors and matches them.
3. **`buildRegionEditPrompt({ dna, regions, params, nativeMask })`**
   - Deterministic English.
   - **Edit mode:** the instruction, plus the region labels and linked object names.
   - **Material mode:** "replace the surface material of <labels> with <material>; keep geometry, edges, openings, lighting direction".
   - **Without a native mask:** explain that the second image is a mask and only its white area may change.
   - Always: keep everything outside the region unchanged.
   - Snapshot tests.
4. **Scene helpers**
   - `newSceneObjectId()`, `sceneObjectLines(dna)`.
   - Compiler `pc-1.3.0`: add preservation lines for pinned objects (`locks.objectIds`), in a deterministic position.
   - Bump the version and update the snapshots deliberately.
5. **Gating:** `isGenerationAllowed("region_edit", …)` behaves like variation.

## Done when

- `npm run verify` is green. Do not edit `apps/**`; if only the app fails for new purposes or strings, note it.
- `docs/agent-notes/p7-domain.md` is written.
