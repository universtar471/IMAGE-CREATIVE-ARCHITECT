# wt/srs-p1a

- Agent: claude
- Tach tu: main
- Tao luc: 2026-10-16 00:51

## Muc tieu

SRS P1a, Space Catalog V3 (`docs/agent-tasks/srs-p1a.md`, ADR-034 and amendments 1–2): converter,
domain registry and resolver, the `SPACE_NOT_IN_BUILDING` rule, the `SPACE SCOPE` compiler
section, sample interior defaults, and the space selector wizard. Nothing is committed (lead's
instruction).

## Da xong

### 1. Converter (`tools/space-catalog/convert.ts`, `npm run catalog:build`)
- Reads `source/building-space-catalog-v3.json` (unchanged) and `label-en.json`, and writes
  `knowledge/space-catalog/catalog.json` (152 presets: townhouse 35, villa 44, apartment 27,
  hotel 24, resort 22). Out-of-scope types are skipped and never written.
- Curated `labelEn` replaces the source label in `labelEn` and, as whole words, in
  `englishPrompt` → `scopeEn`. It also fixes "in a apartment project" → "an apartment".
- Mapping: `buildingArchetypes: [buildingType]`; `zone` from category (outdoor → exterior, or
  semi_outdoor when the English label says balcony / loggia / terrace / rooftop);
  `required` → `requiredIfVerified`; `englishPrompt` → `scopeEn`; `source` and `availability`
  are copied. Items become `{ id, en }`, where `id` is the slug of the text (for example
  `beds_blocking_doors`), and they are the keys used in `SpaceInstance.facts` and
  `approvedOptionalIds`.
- The guard throws `CatalogBuildError`, listing every problem, when:
  - any English text has non-ASCII characters;
  - the folded Vietnamese label (or the id slug) of a record whose `labelVi` has diacritics
    still appears in `labelEn` or `scopeEn`. A missing curated label fails on this check.
    Loanword labels such as "Spa" or "Walk-in closet" are ASCII and allowed;
  - `label-en.json` names an unknown or out-of-scope preset;
  - the output fails `SpaceCatalogFileSchema`.
- Determinism: allowlist order, then source order; the JSON is formatted with the repo's
  Prettier config, so the file passes `prettier --check` and is byte-identical on each run.

### 2. Domain (`packages/domain/src/spaceCatalog/`, exported from the index)
- `schemas.ts`:
  - `CATALOG_VERSION = "sc-3.0.0"`, `SPACE_ARCHETYPE_IDS`, `SPACE_CATEGORIES`, `SPACE_ZONES`
  - `CUSTOM_SPACE_PRESET_ID = "custom"`
  - schemas `SpaceItem`, `SpaceVariant`, `BuildingArchetype`, `SpacePreset`, `SpaceCatalogFile`
- `registry.ts`: `SpaceCatalogRegistry` (`preset`, `archetype`, `spacesFor`, `categoriesFor`).
  Invalid data goes to `issues` and is never thrown, as in `KnowledgeRegistry`.
- `catalog.ts`: `SPACE_CATALOG` and `spacesFor()`. The JSON is a **static import** in domain,
  not the desktop `import.meta.glob` used for packs, because the compiler and the validator
  are pure domain code and need it synchronously. It works in tsc, Vite and vitest.
- `resolve.ts`:
  - `resolveActiveSpace(dna, { targetSpaceId?, catalog? })` returns `{ space, preset | null, custom }`
    or `null`.
  - `spaceScopeLines(dna, …)`.
  - `SPACE_DIMENSION_FACTS = widthM | depthM | heightM`.
- `mapping.ts`:
  - `DEFAULT_ARCHETYPE_BY_PROJECT_TYPE`: townhouse, villa/urban_villa, hotel and resort map to
    an archetype; everything else maps to `null`, including interior.
  - `ARCHETYPE_BY_BUILDING_USE` and `suggestArchetype(projectType, interiorBuildingUse?)`.
  - `INTERIOR_ROOM_BY_PRESET` and `interiorRoomForPreset()`: 86 presets map to an ADR-027 room.
- Schema change: `SpaceInstance.variantId?` (for the variant step). `npm run schema:export`
  was run, and Rust tests are green with it.
- `ids.ts`: `ID_PREFIX.space = "SPC"` and `newSpaceId()` (the UI creates space ids).

### 3. Validator: `SPACE_NOT_IN_BUILDING`
- The space checked is the shot target if given, otherwise the active space.
- A preset that does not list `buildingArchetype` gives BLOCK; an unknown preset id gives WARN
  (which can be accepted). Custom spaces and a DNA without a catalog produce no issue.
- The issue path is `spaceCatalog.spaces[i]`. `useConflictFix` sends it to `design_dna`, and the
  source label is `conflictUi.fromSpace`.

### 4. Compiler (`pc-1.7.0`)
- `prompt/sections/spaceScope.ts` holds `spaceScopeSection(dna)` and
  `allowsInteriorFurnishing(dna)`. `compiler.ts` gains 2 imports, the version bump, one section
  entry (`spaceScope`, right after `subject`), a furnishing guard and `catalogVersion`.
- Section text, active space only:
  - "Space scope: render only the <labelEn> of this <archetype> (<zone>); do not merge in other spaces…"
  - then an optional variant, then "Verified dimensions" (confirmed facts only)
  - "Confirmed elements: …" for required items whose fact is confirmed
  - "Only if present in the approved references: …" for the rest
  - "Approved optional additions, only where they physically fit: …"
  - "Do not introduce: …" (forbidden items minus confirmed ones)
- A custom space compiles a one-line scope with its label. An unknown preset compiles nothing,
  and the validator warns instead.
- `catalogVersion` is `sc-3.0.0` whenever `dna.spaceCatalog` exists, otherwise `"none"`.
- AC-02: when the active preset is not `interior`, the interior DNA "Furnishing:" line is
  dropped, and the garden scope's own items carry no bedroom furniture. This is tested for an
  exterior villa and for an interior project with an interior master-bedroom DNA.
- A DNA without `spaceCatalog` gives the same text. Goldens were updated deliberately: version
  strings in the tests, plus the interior items below.

### 5. Sample dimensions
- They reached the prompt through `createInitialDNA`, which copied the pack's `defaults` into
  the DNA:
  - `living_room` had `dimensions` 5 × 6 × 3, which became "Building form: footprint 5 m x 6 m…"
    for an interior project without interior DNA;
  - both interior packs had `macroContext: "residential apartment"`, which became "Surroundings
    and views: residential apartment."
- Fix: new optional `KnowledgePack.sampleDefaults { note, building, context }`, documented as
  sample data, not verified, never copied into DNA. The values moved there in both interior
  packs (`packVersion` 1.4.0), and `knowledge/README.md` explains it.
- Old projects keep their persisted DNA unchanged and still load and compile the same. The
  legacy golden test rebuilds the 1.3.0 pack (`legacyPack()` in `interior.test.ts`) to prove it.
- Goldens changed: the interior Japandi example loses "Surroundings and views: residential
  apartment." and the `context` section; `compiler.test` now expects `interior/default@1.4.0`.

### 6. UI (`apps/desktop/src/features/space/SpaceSelector.tsx`)
- A `SectionPanel` "Danh mục không gian", shown in `InteriorDnaPanel` (after the Space section)
  and in `BuildingDnaPanel` (after Identity).
- Steps:
  - archetype (5 types, with the suggestion as a hint)
  - group chips plus "Không gian khác / tùy chỉnh"
  - space chips (`*` marks optional-availability presets)
  - variant select, shown only when the preset has variants (no in-scope preset has any today)
- For the active space:
  - evidence badges "Đã xác minh / Chưa rõ / Theo ảnh tham chiếu";
  - width, depth and height fields, blank until measured, written as facts with that evidence;
  - approval chips for optional items (shown as the English prompt text, with a hint saying so).
- It writes `dna.spaceCatalog` (`version: 1`, `buildingArchetype`, `spaces[]`,
  `activeSpaceId`) through `editDna`. Read-only projects are disabled (and `editDna` refuses
  them anyway). Changing the archetype drops `activeSpaceId` if the active preset no longer
  belongs to it.
- i18n: `spaceSelector.*` (vi with diacritics, en) and `conflictUi.fromSpace`.

## Con no

- `SpaceInstance.lockedElementIds` and `floorId` are not used by the UI or the prompt. The
  SRS floor step was left out, as the brief's step list has no floor.
- The ADR-034 preset fields `spaceType`, `cameraIntentIds`, `objectCategoryRules` and
  `promptTemplateId` are not in the schema or the converter (P2 material).
- `scopeEn` is stored but not compiled verbatim. The section is built from the structured
  items, so the evidence rules apply; the curated sentence would otherwise duplicate them.
- With a non-interior active space, an interior project's "Interior space: … master bedroom."
  form line remains. Only the furniture line is dropped, which is what AC-02 covers.
- `INTERIOR_ROOM_BY_PRESET` is only a table: nothing syncs `interior.roomId` from the
  selected preset yet.
- Only the dimension evidence is editable in the UI; per-item facts (confirming a required or
  forbidden item) have no UI yet, though the compiler honours them.
- The New Project wizard now shows "no context" for interior instead of "residential
  apartment"; `sampleDefaults` is not displayed anywhere yet.
- Conflicts with P1b: `COMPILER_VERSION`, the version strings in the same test files, and
  `validation.test.ts`. The old P1 hook test is reduced to OCCLUDED_TARGET only; the
  SPACE_NOT_IN_BUILDING tests are in `space-catalog.test.ts`.

## Lenh test

From the worktree root:
- `npm run catalog:build` regenerates the catalog; the test fails if the file is stale.
- `npx vitest run --project domain tests/space-catalog.test.ts` (24 tests)
- `npx vitest run --project desktop tests/spaceSelector.test.tsx` (4 tests)
- `npm run verify` is green: TS 703 tests in 63 files, Rust 286 passed and 6 ignored.
- `npx prettier --check .` is clean.
- Rust sources were not touched; only the generated JSON schema changed.

## Cam bay da gap

- `tests/helpers.ts` `loadSeedRegistry` read every `knowledge/*/*` entry as a pack folder, so
  `knowledge/space-catalog/catalog.json` broke the suites that load packs. It now skips
  non-directories. The desktop glob (`knowledge/*/*/pack.json`) was already safe.
- Prettier collapses short JSON arrays, so plain `JSON.stringify(…, null, 2)` output fails
  `prettier --check`. The converter formats through Prettier itself.
- The label "Building type" already existed (`dna.buildingType`), and `getByLabelText` in
  `interior.test.tsx` found two matches. The selector label is "Building type (catalog)" /
  "Loại công trình (danh mục)".
- Windows: Python text-mode writes turn LF into CRLF; edit files in binary mode.
- Source prompts repeat short labels ("spa" ×3). The substitution is whole-word so it never
  touches "space".
