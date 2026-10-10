# Master-consistent anchors — domain, packs, backend (ADR-028, API §19)

**Branch:** `wt/anchor-domain`.

**You own:**
- `packages/domain/**`
- `knowledge/**`
- `apps/desktop/src-tauri/**`
- `apps/desktop/tests/fixtures/backend/**`
- the generated JSON schema files

## Read first

- ADR-028 and API §19 are the single source of truth. Also read ADR-016, ADR-022, ADR-027 and §18.
- `packages/domain/src/prompt/compiler.ts`: the subject, reference, preservation, camera and negative sections, and the interior branches from pc-1.4.0.
- `packages/domain/src/camera/describe.ts`
- `packages/domain/src/schemas/context.ts`
- `packages/domain/src/knowledge/pack.ts`
- `knowledge/*/*/pack.json`
- `apps/desktop/src-tauri/src/services/dna_validation.rs`

## Scope

1. **Schema.** Add `siteTopology` to the context schema, with the refinement, per §19.1. `ContextPartialSchema` accepts it. Regenerate the JSON schema with `npm run schema:export`; if the sandbox throws ENOMEM, use the esbuild workaround and note it. Mirror the refinement in Rust `validate_additive_fields`, and add Rust tests for:
   - a valid DNA
   - a corner lot without `cornerSide`
   - a corner side that is attached
   - a DNA without `siteTopology`, which stays unchanged
2. **Helpers** in `prompt/topology.ts`, per §19.2, exported from the index. Test every row of the mode table. Inference tests cover:
   - the Vietnamese text "nhà liền kề" with and without diacritics
   - "party wall"
   - a manual `unknown` value that is overridden by inference
   - an explicit `open` value that beats the text
3. **Compiler pc-1.5.0**, per §19.3:
   - framing by `viewType`
   - the new exterior master text, and the appended interior text
   - the mode lines and the camera override for `oblique_street`
   - `plot` replaced for `aerial_block`
   - deduped contextual negatives
   - `stylePhrases.ts`

   Tests:
   - Golden test: the real failure DNA. A townhouse, both sides "attached neighbouring townhouse", density high, 3 anchor cameras `front_left_corner`, `front_right_corner` and `aerial_three_quarter`, plus a master.
     - The front-left prompt contains no "left side" wording and has the party-wall line and the negatives.
     - The aerial prompt starts with "aerial architectural view", contains no "plot", and has the block line.
   - A villa with both sides `open`: the corner view stays `normal`.
   - A corner lot on the left: `corner_side`.
   - The interior project output equals pc-1.4.0, apart from the version string, the framing change and the appended master line. Assert this explicitly.
   - Projects without a camera keep the pack framing.
   - Style phrase matching, case- and diacritics-insensitive, and passthrough when unknown.
4. **Interior catalog prompt strings**, per §19.3. Change only the English `prompt` text, never ids or `vi`/`en` labels. Update the snapshots deliberately.
5. **Packs**, per §19.4, with `packVersion` bumps. Add a pack test that loops every pack and every preset with the townhouse-style attached context and asserts:
   - no compiled anchor prompt contains `plot` when density is high
   - none contains "showing the front facade and the left side" when both sides are attached
   - interior wide lenses are at least 20 mm
6. Update `docs/API_CONTRACTS.md` only if a signature had to change. If it did, explain why in the agent note.

## Done when

- `npm run verify` is green.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` (manifest `apps/desktop/src-tauri/Cargo.toml`) and `npx prettier --check .` are clean.
- `docs/agent-notes/anchor-domain.md` is written.
- Do not edit `apps/desktop/src/**`. If app tests break only because of the version string or the snapshots, note it for the integrator.
