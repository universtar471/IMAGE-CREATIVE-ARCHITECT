# P4-A — Domain: lighting/weather/mood DNA, pack presets, compiler pc-1.2.0, grade math

Branch `wt/p4-domain` (from main).

Read first:
- `tasks/PHASE_04.md`
- ADR-001, ADR-008, ADR-019…021
- `docs/API_CONTRACTS.md` §12
- `packages/domain/src/schemas/future.ts`, `projectDna.ts`
- `knowledge/pack.ts`, `knowledge/registry.ts`, the pack JSON files
- `prompt/compiler.ts`, `generation/batch.ts`, `camera/`
- the existing tests

You own `packages/domain/**` and the knowledge pack files. Do not edit `apps/**`.

## Scope

1. **Schemas** (additive; every existing DNA and test fixture must still parse), as in §12.1:
   - `presetId` on lighting, weather and mood
   - artificial light `id` (`LGT_<ULID>`, with a helper like the camera id helper) and `enabled`
   - `LockState.mood`
   - vocabulary constants for time of day, light zones and grade look ids

   Re-export the JSON Schema (`npm run schema:export`, see package scripts) and include the regenerated file.

2. **Knowledge packs 1.2.0** (§12.2):
   - For every pack, add `lightingPresets` (≥4), `weatherPresets` (≥3) and `moodPresets` (≥4).
   - Values must be realistic for the project type. Tropical packs include a monsoon-rain preset and a blue-hour preset. Urban packs include a night street-light preset.
   - Extend registry resolution the same way as `cameraPresets`.
   - Pack tests check the counts, the ids, and that the values parse as partial sections.

3. **Compiler `pc-1.2.0`:**
   - Emit separate Lighting, Weather and Mood sections in a deterministic order (after Context, before Camera, or wherever is consistent). Document the order.
   - Render each enabled artificial light as "<zone> at <K>K, <intensity>".
   - Add lock preservation lines for lighting, weather and mood.
   - Bump `compilerVersion`.
   - Output stays deterministic. Update snapshot tests deliberately.
   - Add `compileWithOverrides(dna, overrides)` (or an options field) so a mood variation can override the lighting/weather/mood sections. Locked sections ignore overrides.

4. **Mood variations builder** (ADR-021):
   - `buildMoodVariationItems({ dna, project, sourceAssetId, presets, model, params, ... })` returns `BatchItem[]`, one item per preset, labelled with the preset label.
   - The source is the first reference, with the master/anchor role semantics the compiler already uses.
   - Add a preservation instruction: keep the architecture, camera and composition; change only light, weather and atmosphere.
   - Respect `maxReferenceImages` like the production builder: fail with a clear error rather than drop the source.
   - Add `adoptMoodPreset(dna, preset)`, which returns a new DNA and skips locked sections.

5. **Grade math** (ADR-020, §12.3):
   - In `packages/domain/src/grade/apply.ts`: `applyGradePixel(rgb, grade)` and `applyGradeToImageData(data: Uint8ClampedArray, grade)`. Both pure and allocation-light.
   - Built-in looks: `GRADE_LOOKS: Record<lookId, ColorGradeDNA>`.
   - Generate `packages/domain/test-vectors/grade.json`:
     - grades: at least 12, covering each slider alone at ±100 and ±50, every look, and the all-zero identity
     - inputs: each grade × the same fixed set of ≥16 colours (black, white, greys, primaries, skin, sky and foliage tones)
   - Add a script or test that regenerates the vectors, and a test that the identity grade is exact.
   - P4-B's Rust parity test reads this same file.

## Done when

- `npm run verify` is green.
  - If the desktop app breaks because of your additive change, do NOT edit `apps/**`; note it for P4-C.
- `docs/agent-notes/p4-domain.md` is written.
