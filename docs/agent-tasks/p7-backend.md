# P7-B — Backend: regions storage/commands, mask raster mirror, region_edit with native mask or composite

Branch `wt/p7-backend`. You own `apps/desktop/src-tauri/**` and `apps/desktop/tests/fixtures/backend/**`.

## Read first

- `tasks/PHASE_07.md`, ADR-025, API §16, ADR-022..024
- `providers/openai` (images/edits multipart), `providers/hhtech/catalog.rs`, `providers/gemini`, `providers/mod.rs` (capabilities)
- `services/generations.rs` (validate, `store_outputs`, `commit_outputs`); the enhance exact-resize path as the pattern for post-processing outputs
- `services/workflow.rs`, `migrations/`, `contract_fixtures.rs`

## Scope

1. **Migration `0006_regions.sql`** per §16.4. Add a test that asset delete cascades.
2. **Region commands** `region_list`, `region_save`, `region_delete` per §16.2:
   - validation of shapes: coordinates finite and within 0..1; polygon has ≥3 points; brush radius > 0
   - `objectId` must exist in `dna.scene`
   - archived checks
   - DTOs and command registration
3. **Mask raster mirror** `services/regions/mask.rs`:
   - `rasterize_mask` and `feather_mask`, exactly per §16.1.
   - Test against `packages/domain/test-vectors/masks.json`: exact match for masks, ±1 for feathered values.
   - The domain agent creates that file in parallel. Until it lands, ship a small local vectors file under `src-tauri/tests/` computed from the spec, and prefer the domain file when it exists. Note that the domain file must pass after the merge.
4. **`supportsMask` capability**
   - true: OpenAI official and HHTECH GPT-family catalog models
   - false: Gemini (direct and HHTECH Gemini), `local_preview`, `local_upscale`
   - Add it to the DTOs and fixtures.
5. **Purpose `region_edit`** (§16.3)
   - Validation:
     - exactly one ready reference (the asset)
     - `params.region` is valid
     - every region belongs to that asset
     - gating is the same as variation
   - Provider call:
     - native: add a multipart `mask` PNG. It is RGBA at source size; alpha 0 where the mask is 255.
     - otherwise: append the mask PNG (white on black) as a second image
   - After the outputs come back:
     1. resize each to the source size (Lanczos3)
     2. composite over the source with the mask feathered by 8 px, scaled to the source: `out = src*(1-a) + gen*a`
     3. store the result as a new asset and version, with `operation = "region_edit"` and the `operation_json` / meta of §16.3
   - Do the image work outside the DB lock.
6. **Tests**
   - mock HTTP: the native mask field is present and correct for native providers, and the second image is used for Gemini
   - composite: pixels outside the feathered mask exactly equal the source, and pixels inside differ
   - validation errors
   - gating
   - `#[ignore]` `hhtech_live_region_edit`
7. **Contract fixtures:** regenerate with `UPDATE_BACKEND_FIXTURES=1 cargo test contract_fixtures`.

## Done when

- `npm run verify` is green, or blocked only by UI/domain integration items listed in the note.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `npx prettier --check .` are clean.
- `docs/agent-notes/p7-backend.md` is written.
