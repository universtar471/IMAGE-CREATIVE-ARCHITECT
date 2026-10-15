# SRS P0 — project facts, extensions, unified conflict validator, prompt versioning (ADR-034)

**Branch:** `wt/srs-p0`.

**Read first:**
- ADR-034 in `docs/DECISIONS.md`.
- `docs/specs/MASTER_SPEC_SRS_1_0.md`, sections 1, 3, 12, 14, 16 and 17.
- The current schemas: `packages/domain/src/schemas/{projectDna,context}.ts`, `prompt/compiler.ts`, `prompt/topology.ts`.
- On the Rust side: `apps/desktop/src-tauri/src/services/dna_validation.rs`.

## Scope

1. `packages/domain/src/facts/`: `EvidenceRefSchema` and `isConfirmed`.
2. Optional extensions on `ProjectDNASchema` per ADR-034: `spaceCatalog`, `site`, `architecturalDetails`.
   - `schemaVersion` stays 1.
   - Regenerate the JSON schema with `npm run schema:export`. Rust must accept it.
3. `packages/domain/src/site/adjacency.ts`: `resolveSiteAdjacency(dna)`, including the derivation from `context.siteTopology` described in ADR-034. The visibility resolver is P1 and is not part of this task.
4. `packages/domain/src/validation/`:
   - `CONFLICT_CODES` (all SRS §12.4 codes)
   - `validateShot`, and `VALIDATOR_VERSION = "cv-1.0.0"`
   - the P0 rules: `ADJACENT_BUILDING_CONFLICT` (camera plan and extra prompt, vi and en phrases), `UNVERIFIED_GEOMETRY`, `LOCKED_LIGHTING_CONFLICT`
   - `SPACE_NOT_IN_BUILDING` and `OCCLUDED_TARGET`: hooks that return no issues until P1 supplies the catalog and visibility data
   - WARN exceptions
5. `PromptBundle` gains:
   - `validatorVersion`
   - `catalogVersion` (`"none"` until P1)
   - `sourceHash` and `configHash`: sha256 of canonical JSON. Use a small pure-TS sha256 or the existing hashing helper in the domain if one exists; no new dependency without need.
   - `resolvedWarnings`

   Then:
   - Keep the bundle byte-identical for identical input.
   - Update the golden or snapshot tests.
   - The compiler version stays `pc-1.6.0` in P0, because prompt text does not change; only metadata changes.
6. Desktop gate:
   - Before every paid generation submit (generate, variations, anchors, batch, enhance generative, region edit), call `validateShot`.
   - BLOCK disables submit and shows the reason with "Sửa lựa chọn".
   - WARN shows "Duyệt ngoại lệ".
   - The validated verdict and any accepted exceptions go into the generation request snapshot.
   - The Rust backend refuses a request whose snapshot verdict is BLOCK, with `VALIDATION_ERROR`.
   - The free-text extra prompt is validated before it is appended (AC-22).
   - i18n in vi (with diacritics) and en for every code message.
7. Tests:
   - AC-20: an old DNA fixture without extensions survives parse → save → reopen with nothing lost, in both TS and Rust roundtrips.
   - AC-21: byte-identical bundle.
   - AC-22: an extra prompt asking to open the side of an attached townhouse is blocked before any provider call.
   - Validator unit tests per rule.
   - A Rust test that the BLOCK snapshot is refused.

## Done when

- `npm run verify` and `npx prettier --check .` are green.
- `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` are clean.
- `docs/agent-notes/srs-p0.md` is written.
- Do not commit.
