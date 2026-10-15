# SRS P2b — Architectural detail registry and detail shot planner (ADR-036)

**Branch:** `wt/srs-p2b`.

## Read first

- ADR-036 and ADR-034 in `docs/DECISIONS.md`.
- `docs/plans/SRS_V7_2_UPGRADE_PLAN.md` §3.
- SRS §5.3 and §5.4, and AC-05.
- `packages/domain/src/schemas/extensions.ts` (`DetailRecordSchema` from P0).
- `packages/domain/src/site/*` (`resolveVisibility`), read only.
- `packages/domain/src/validation/*`.
- `packages/domain/src/prompt/compiler.ts` and `prompt/sections/*`.
- `apps/desktop/src/features/camera/*`.

## Scope

1. **Domain:** `packages/domain/src/detail/`.
   - **Registry.** `ArchitecturalDetailRegistry` helpers: list, add, update and remove details in `dna.architecturalDetails`. This module is the only writer of that field.
     - Detail fields: `id`, `spaceId`, `facade`, `floorId`, `verifiedLocation`, `materialIds`, `existence`, `sourceAssetIds`, `locked`.
     - Extend the P0 schema only if a field is missing, and keep old DNA parsing. If the schema changes, run `npm run schema:export`.
     - Add a Rust test that the extended DNA still validates.
   - **Planner.** `planDetailShots(dna, { count 1..10, mode: auto | manual, detailIds? })` returns `{ shots: [{ detailId, cameraSuggestion, angleIndex }], shortfall, warnings }`.
     - Use only verified details. With 5 shots and 3 details, plan distinct angles of the 3 or report the shortfall (AC-05). Never invent details.
     - Choose a camera that `resolveVisibility` says can see the detail's facade.
     - Never pick the same angle twice for the same detail.
     - A shot type is one of `approach`, `architectural_detail` or `material_closeup`.
2. **Validator.** `OCCLUDED_TARGET` covers `shotIntent.targetDetailId`.
   - A camera that cannot see the detail's facade gives WARN, and the UI shows it as "chọn lại góc".
   - A detail that does not exist gives BLOCK.
   - Add a test for a second-floor front balcony that keeps the right floor and facade, and gives WARN/RESELECT when the camera cannot see it (SRS §5.4).
3. **Compiler.** Add a `DETAIL TARGET` section in `prompt/sections/detailTarget.ts`, following the SRS §5.3 example, emitted only when `targetDetailId` is set.
   - Set `COMPILER_VERSION` to `"pc-1.8.0"`.
   - Prove that the output without a target is unchanged apart from the version string.
4. **ShotIntent.** Add optional `targetDetailId` and `detailShotCount` to the `ShotIntent` type and schema. If `PromptBundle.shotIntent` does not exist yet, add it as optional in both TS and the Rust DTO; the lead resolves this against P2a.
5. **UI:** `apps/desktop/src/features/detail/`.
   - A detail editor with facade, floor, location, evidence badge and materials.
   - "Khám phá chi tiết": a list of confirmed details, a shot count from 1 to 10, auto or manual selection, and the planned shots with any shortfall warning.
   - Generating the planned shots creates a batch through the existing batch flow and the conflict gate.
   - Read-only projects cannot edit.
   - i18n in Vietnamese with full diacritics, and in English.

## Out of scope

Do not touch:
- `camera/intent.ts`
- `features/camera/VisualIntentSelector.tsx`
- `packages/domain/src/{effects,sceneObjects,contextLibrary,spaceCatalog}/**`
- `features/{effects,sceneObjects,enhance}/**`

## Done when

- `npm run verify` and `npx prettier --check .` pass.
- In `apps/desktop/src-tauri`, `cargo fmt --check`, `cargo clippy --offline --all-targets -- -D warnings` and `cargo test --offline` pass.
- `docs/agent-notes/srs-p2b.md` is written.
- Do not commit. Do not touch `.env`. Make no paid calls.
