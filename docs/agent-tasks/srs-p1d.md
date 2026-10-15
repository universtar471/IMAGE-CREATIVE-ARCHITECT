# SRS P1d — Wire Context Library V4 into the DNA, compiler and context panel

**Branch:** `wt/srs-p1d`.

## Read first

- ADR-034 and both of its amendments, and ADR-028, in `docs/DECISIONS.md`
- `docs/plans/SRS_V7_2_UPGRADE_PLAN.md` §3, rule 5: Context V4 sits at the bottom of the priority order
- These merged modules:
  - `packages/domain/src/contextLibrary/*`
  - `site/*`
  - `prompt/compiler.ts`
  - `prompt/sections/*`
- The context panel UI under `apps/desktop/src/features/` (find `ContextDnaPanel`) and the site editor `features/site/*`

## Scope

1. **Schema.** Add an optional `context.library` field to `ContextDNA`:
   - `{ version: 1, presetId, regionId, approvedOptional: string[] }`
   - The context panel is the only writer of this field.
   - Old DNA must still parse.
   - Run `npm run schema:export`.
   - Add a Rust test that DNA with the field validates and roundtrips. Add it to `dna_validation.rs` and to the shared fixture if useful.
2. **Compiler.** When `context.library` is set, add a `CONTEXT SUGGESTIONS` section in `prompt/sections/contextSuggestions.ts`:
   - Build it from `suggestContext(dna, presetId, regionId)`.
   - Required cues use the "only when consistent with verified site evidence" wording.
   - Optional cues appear only when they are in `approvedOptional`.
   - Include the forbidden cues and the region details and avoids.
   - Never include `droppedForEvidence` cues.
   - It must never contradict the `SITE & OCCLUSION` section. Add a test with an attached townhouse plus a villa-grounds preset: the cue is dropped.
   - Set `COMPILER_VERSION` to `"pc-1.8.0"`. Other P2 branches set the same value; the lead resolves the conflict.
   - Set the bundle's config provenance to include `contextLibraryVersion` when it is used.
   - Output without `context.library` must be unchanged apart from the version.
3. **UI.** In the context panel, add a "Gợi ý bối cảnh (thư viện V4)" section:
   - A preset picker filtered by the project's archetype, using `contextSuggestionsFor`.
   - A region picker.
   - Optional cue checkboxes.
   - The `droppedForEvidence` list, with the reason "mâu thuẫn với dữ liệu khu đất".
   - A clear note that site evidence always wins.
   - Read-only projects cannot edit.
   - Strings in Vietnamese with full diacritics, and in English.
4. **Tests.** Cover the schema roundtrip, the compiler section, the evidence-drop case, output unchanged without the library, and the UI writing `context.library`.

## Out of scope

Do not touch:
- `packages/domain/src/{detail,effects,sceneObjects,diagram,publishing,spaceCatalog}/**`
- `features/{detail,effects,sceneObjects,diagram,publishing,enhance,camera}/**`

## Done when

- `npm run verify` and `npx prettier --check .` pass.
- In `apps/desktop/src-tauri`, these pass:
  - `cargo fmt --check`
  - `cargo clippy --offline --all-targets -- -D warnings`
  - `cargo test --offline`
- `docs/agent-notes/srs-p1d.md` is written.
- Do not commit. Do not touch `.env`. Make no paid calls.
