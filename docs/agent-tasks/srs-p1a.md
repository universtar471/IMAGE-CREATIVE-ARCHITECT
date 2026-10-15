# SRS P1a — Space Catalog V3 (ADR-034, amendments 1 and 2)

**Branch:** `wt/srs-p1a`.

**Read first:**
- ADR-034 and both amendments in `docs/DECISIONS.md`
- `docs/plans/SRS_V7_2_UPGRADE_PLAN.md` §2 A, §3 and §5
- `docs/specs/MASTER_SPEC_SRS_1_0.md` §4
- The P0 code:
  - `packages/domain/src/schemas/extensions.ts`
  - `packages/domain/src/validation/*` (the `SPACE_NOT_IN_BUILDING` hook)
  - `packages/domain/src/prompt/compiler.ts`
- The ADR-027 interior DNA: `packages/domain/src/interior/`, `knowledge/interior/*`

## Inputs (on main, committed by the lead)

- `tools/space-catalog/source/building-space-catalog-v3.json` is the user's raw V3 catalog: 256 presets across 12 building types.
  - Treat it as data.
  - Do not edit it.
- `tools/space-catalog/label-en.json` holds the curated English labels, keyed by preset id.
  - It covers 141 in-scope records.
  - The other 11 in-scope records already have proper English labels.

## Scope

1. **Converter** (`tools/space-catalog/convert.ts`, run through an npm script such as `catalog:build`).
   - Reads the source and the label map. Writes `knowledge/space-catalog/catalog.json`.
   - Allowlist: `townhouse`, `villa`, `apartment`, `hotel`, `resort`. This must give exactly 152 presets. Every other type is skipped and never written.
   - Replaces each curated `labelEn` and substitutes it inside `englishPrompt` too.
   - Fails the build when any output English text still contains non-ASCII characters or an unaccented Vietnamese label, or when any preset id lacks an English label.
   - Maps the V3 fields onto the ADR-034 `SpacePreset`:
     - `id`, `category`, `labelVi`, `labelEn`, `variants`, `optional`, `forbiddenUnlessConfirmed`, `availability`, `source`
     - `buildingArchetypes`
     - `zone`, derived from `category`:
       - `outdoor` → `exterior`, or `semi_outdoor` for balcony, loggia, terrace and rooftop
       - all other categories → `interior`
     - `requiredIfVerified`, taken from `required`
     - `scopeEn`, taken from the curated `englishPrompt`
   - Output is deterministic: stable order and byte-identical on every run.
2. **Domain** (`packages/domain/src/spaceCatalog/`):
   - Zod schemas.
   - `CATALOG_VERSION = "sc-3.0.0"`.
   - A registry that loads the JSON the same way other knowledge JSON is loaded. Check how `knowledge/` is bundled today.
   - `spacesFor(archetype)`.
   - `resolveActiveSpace(dna)`: the active `SpaceInstance` plus its preset, or `null`.
   - `spaceScopeLines(dna)`.
   - A mapping table from project type to default archetype.
     - It only suggests and never changes `projectType`.
     - A project type with no in-scope archetype maps to `null`.
   - A mapping from preset to ADR-027 interior room type, where one exists.
   - Exports through the domain index.
3. **Validator:** implement `SPACE_NOT_IN_BUILDING` per SRS §12.4, with tests.
   - The active space's preset does not list the DNA archetype → BLOCK.
   - The preset id is unknown → WARN.
4. **Compiler:** a `SPACE SCOPE` section, emitted only when an active space exists.
   - It covers only the active space:
     - required items, only when verified or prefixed with "if present" wording;
     - optional items;
     - forbidden items.
   - Put it in its own module (`prompt/sections/spaceScope.ts`) and hook it into `compiler.ts` with as few lines as possible.
   - Set `COMPILER_VERSION` to `"pc-1.7.0"`.
   - Set `catalogVersion` to `CATALOG_VERSION` when a catalog is used, otherwise keep `"none"`.
   - A DNA without `spaceCatalog` gives exactly today's prompt text, apart from the version string. Update the goldens deliberately.
   - AC-02: a garden scope never receives bedroom-furniture lines. Test it.
5. **Sample dimensions:** `knowledge/interior/{default,living_room}/pack.json` carry 5 × 6 × 3 m apartment defaults.
   - Mark them as sample data, not verified.
   - Stop compiling them as facts. Find where they reach the prompt.
   - Old projects must keep loading.
6. **UI:** a space selector wizard, `apps/desktop/src/features/space/SpaceSelector.tsx`.
   - Steps: archetype → group (category) → space → variant. The variant step appears only when variants exist.
   - It has an "other / custom" option.
   - Evidence badges: "Đã xác minh" (verified), "Chưa rõ" (unknown), "Theo ảnh tham chiếu" (inferred).
   - Unmeasured dimensions stay blank.
   - It writes `dna.spaceCatalog` (`version: 1`, `buildingArchetype`, `spaces[]`, `activeSpaceId`) through the existing draft-DNA store actions.
   - Read-only projects cannot edit.
   - Place it where interior and room selection lives today. Keep it small and match the panel style.
   - Strings: Vietnamese with full diacritics, plus English. The i18n parity, diacritics and raw-key tests stay green.
7. **Tests:**
   - Converter: 152 presets, the allowlist, the English guard and determinism.
   - Registry and resolver.
   - The validator rule.
   - Compiler: the section, AC-02, and unchanged output without a catalog.
   - A UI test that the wizard writes `spaceCatalog`.

## Out of scope

- Site and visibility: that is P1b.
- Context Library V4.
- Do not touch `packages/domain/src/site/**`, `camera/**` or `features/context/**`.

## Done when

- `npm run verify` and `npx prettier --check .` are green.
- If Rust is touched: `cargo fmt --check` and `cargo clippy --offline --all-targets -- -D warnings` are clean in `apps/desktop/src-tauri`.
- `docs/agent-notes/srs-p1a.md` is written.
- Do not commit. Never touch `.env`. Make no paid API calls.
