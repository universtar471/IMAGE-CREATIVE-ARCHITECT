# Interior DNA — domain + backend (ADR-027, API §18)

**Branch:** `wt/interior-domain`.

**You own:**
- `packages/domain/**`
- `apps/desktop/src-tauri/**`
- `apps/desktop/tests/fixtures/backend/**`
- the generated JSON schema files

## Read first

- ADR-027 and API §18. These are the single source of truth; implement the ids exactly.
- `packages/domain/src/schemas/projectDna.ts`. Phase 7's `scene` is an additive section; use it as the pattern.
- `packages/domain/src/prompt/compiler.ts`: the `isInterior` branches, the section order and the master-priority lines.
- `knowledge/interior/*/pack.json`.
- `apps/desktop/src-tauri/src/services/dna_validation.rs`: schema validator plus additive checks.

## Scope

1. `packages/domain/src/interior/`
   - `catalog.ts`: every list in §18.2, as `{ id, vi, en, prompt }`. Palettes and surface materials also get `swatches` / `swatch` hex values.
     - Vietnamese labels with proper diacritics.
     - Every style references a palette and preset that exist.
     - Every preset covers all 7 slots with valid ids.
   - `schemas.ts`: Zod `InteriorDNASchema` per §18.1, with the `roomId` ∈ `roomsForUse` refinement and the per-slot id checks. Add `interior` as an optional field to `ProjectDNASchema`.
   - `helpers.ts`: every helper in §18.3. Export them all from the package index.
2. Compiler `pc-1.4.0` per §18.4.
   - Snapshot or inline tests: the full Japandi living-room example, empty slots omitted, furnishing, interior lighting, and the camera preset fallback.
   - Without `dna.interior` the output stays byte-identical apart from the version string. Prove it with a test that compiles an existing fixture both ways.
3. Tests
   - catalog integrity: unique ids, valid references, every preset complete, diacritics present in `vi`
   - cascade (`roomsForUse` for every use; `other` is always valid)
   - `applyStyleDefaults` keeps user-set slots
   - `proposeInteriorFromLegacy` matches without mutating its input
   - schema refinements
4. Backend
   - Regenerate the JSON schema (`npm run schema:export`). If the sandbox ENOMEM error happens, write the schema with the esbuild workaround used before, or note it in the agent note so the lead can run it.
   - Mirror the `roomsForUse` rule in `validate_additive_fields`, with the error at `interior.roomId`.
   - Rust tests: a valid interior DNA is accepted; a bad room for the building use is rejected; DNA without `interior` is unchanged.
   - Regenerate the contract fixtures if they change.

## Done when

- `npm run verify` is green.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `npx prettier --check .` are clean.
- `docs/agent-notes/interior-domain.md` is written.
- Do not edit `apps/desktop/src/**`. If the app fails only because of the new compiler version or strings, note it.
