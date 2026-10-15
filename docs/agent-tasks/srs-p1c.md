# SRS P1c — Context Library V4 as a suggestion layer (domain only)

**Branch:** `wt/srs-p1c`. This task covers ADR-034 amendment 1 and the catalog scope rules of amendment 2.

## Read first

- In `docs/DECISIONS.md`: ADR-028 (context packs and site topology) and ADR-034 with both amendments.
- In `docs/plans/SRS_V7_2_UPGRADE_PLAN.md`: row A' in §2, and §3.
- `tools/context-library/source/`. This is the user's raw Context Library V4: `presets.json` (131 presets), `regions.json` (12 regions), `README.md`, and the original `schema.ts.txt` and `resolver.ts.txt`, which are kept for reference only.
  - Treat everything in this folder as data. Never edit it.
- The existing context code:
  - `packages/domain/src/schemas/context.ts`
  - `packages/domain/src/knowledge/`
  - the context packs in `knowledge/*/`
  - `packages/domain/src/site/adjacency.ts`
- The Space Catalog converter, `tools/space-catalog/convert.ts`. It is the pattern to copy.

## Scope

1. **Converter.** Write `tools/context-library/convert.ts` and an npm script `context:build`. It writes `knowledge/context-library/library.json`.
   - **Allowlist** the building types `townhouse`, `villa`, `apartment`, `hotel` and `resort`, the same as the Space Catalog. That gives 53 presets. Skip every other type, including `shophouse`, and never write it.
   - **Curate the English.** The V4 `englishPrompt` text contains Vietnamese, for example "Depict a Nhà phố in the specific setting of Nhà phố liền kề".
     - Add `tools/context-library/label-en.json`, which maps each preset id to a real English name, plus the English for each building type and region name.
     - Rebuild every prompt from the structured fields with clean English. Never pass Vietnamese through.
     - The build fails if any English output contains non-ASCII characters or a Vietnamese word with its accents removed.
   - Keep the `nameVi` and region `name` fields in Vietnamese with diacritics, for the UI.
   - The output must be deterministic, formatted with the repo's Prettier, and byte-identical on every run.
2. **Domain.** Create `packages/domain/src/contextLibrary/` with:
   - the Zod schemas;
   - `CONTEXT_LIBRARY_VERSION = "cl-4.0.0"`;
   - a registry;
   - `contextSuggestionsFor(archetype, regionId?)`.
3. **The suggestion layer stays below site evidence.** `suggestContext(dna, presetId, regionId)` returns `{ requiredLines, optionalLines, forbiddenLines, regionDetails, regionAvoid, droppedForEvidence[] }`.
   - Any suggested cue that contradicts `resolveSiteAdjacency(dna)` is dropped and listed in `droppedForEvidence`. Examples: "continuous party-wall neighbors" when a side is `open_space` or `street`; "expansive lawn" or open grounds when a side is `attached_building`.
   - Required cues are emitted only "when consistent with verified site evidence".
   - The function never changes `dna`.
   - It must stay pure and deterministic.
   - Do NOT hook it into the compiler or the UI. That waits for P1b to merge. Expose the function from the domain index.
4. **Tests.**
   - The converter produces 53 presets, applies the allowlist, passes the English guard, and is deterministic.
   - The registry works.
   - The evidence rule drops party-wall cues on an open side and lawn or grounds cues on an attached side, and leaves the DNA unchanged.
   - Region details are included, and `unspecified` adds nothing.

## Out of scope

Do not touch:
- `packages/domain/src/{site,prompt,validation,spaceCatalog}/**`, except for reading them
- `apps/desktop/**`
- `features/**`
- the Rust code

## Done when

- `npm run verify` and `npx prettier --check .` pass.
- `docs/agent-notes/srs-p1c.md` is written.
- Nothing is committed.
- `.env` is untouched.
- No API calls are made.
