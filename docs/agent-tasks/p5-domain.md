# P5-A — Domain: enhance params, prompt, gating (ADR-023, API §14)

Branch `wt/p5-domain`. You own `packages/domain/**` only.

Read first:
- `tasks/PHASE_05.md`
- ADR-023 and API §14
- ADR-022 / §13, plus `packages/domain/src/workflow/`
- `schemas/generation.ts`, `prompt/compiler.ts`
- `generation/batch.ts` (as the pattern for `buildMoodVariationItems`)

## Scope

1. **Schemas**
   - `GenerationPurposeSchema` gains `"enhance"`.
   - Add `EnhanceParamsSchema` exactly per §14.1, with defaults `detailStrength` 40 and `architecturePreserve` true.
   - `params.enhance` is optional on generation params and required when `purpose === "enhance"`. Use a refinement with a clear message.
   - Add the cross-field rules of §14.1 that the domain can check without image sizes:
     - `conservative` needs a target and `providerId` `local_upscale`
   - Re-export the JSON Schema and commit the regenerated file.

2. **`buildEnhancePrompt({ dna, params })`**
   - Deterministic English text.
   - Preserve instruction when `architecturePreserve` is true.
   - Detail bucket:
     - 0–33 low
     - 34–66 medium
     - 67–100 high
   - A one-line material summary from the building DNA, when present.
   - The "never change the building" line always.
   - Snapshot tests.

3. **`buildEnhanceItems({ sources, params, providerId, model, ... })`**
   - Returns `BatchItem[]`, one per source asset, each with the source as the only reference and the label "Enhance — <asset name>".
   - Fails clearly when the model cannot take a reference.

4. **Gating**
   - `isGenerationAllowed("enhance", ...)` follows `variation`.
   - `deriveWorkflow` is unchanged.

5. **Helpers**
   - `ENHANCE_TARGETS = [2048, 3072, 4096]` and `MAX_ENHANCE_EDGE = 8192`.

## Done when

- `npm run verify` is green. Do not edit `apps/**`.
- `docs/agent-notes/p5-domain.md` is written, listing the exported names and signatures.
