# wt/srs-p0

- Agent: claude
- Tach tu: main
- Tao luc: 2026-10-15 19:15

## Muc tieu

P0-A of `docs/agent-tasks/srs-p0.md` (ADR-034): the domain half. Scope items 1–5 plus the
domain-side tests of item 7 (AC-20 TS + Rust, AC-21, AC-22 at validator level, rule tests).
Item 6 (desktop gate UI, Rust BLOCK refusal) is P0-B and NOT done here.

## Da xong

### Group 1 — facts + DNA extensions
- `packages/domain/src/facts/evidence.ts`: `EvidenceRefSchema`
  (`status`, `sourceAssetIds` default `[]`, `approvedByUser?`, `confidence?` 0..1),
  `isConfirmed` (verified | user_declared), `unknownEvidence()`.
- `packages/domain/src/schemas/extensions.ts`: `SiteExtensionSchema` (version 1,
  `viewer_facing_front_facade`, four `SiteBoundary` sides with `kind`, `evidence`,
  `neighborObjectId?`, `heightRelation?`), `SpaceCatalogExtensionSchema` (version 1,
  `buildingArchetype`, `spaces: SpaceInstance[]`, `activeSpaceId?`; TS-only refine: unique
  space ids, activeSpaceId must exist; every fact needs a `value`), `DetailRecordSchema`
  (each record has `version: 1` because the extension is a plain array).
- `ProjectDNASchema` gains optional `spaceCatalog`, `site`, `architecturalDetails`;
  `schemaVersion` stays 1. JSON schema regenerated (`npm run schema:export`).
- Shared fixtures: old DNA = `apps/desktop/tests/fixtures/nhapho-dna.json`; extended DNA =
  `packages/domain/test-vectors/dna-v1-extensions.json`. Both are used by TS and Rust tests.
- Rust: `dna_validation.rs` tests (legacy accepted unchanged, extensions accepted, bad
  extension values / unknown keys rejected); `dna.rs` SQLite save → reopen roundtrip for both.

### Group 2 — site adjacency
- `packages/domain/src/site/adjacency.ts`: `resolveSiteAdjacency({ site, context })`.
  `site` wins verbatim. Otherwise derived via `resolveSiteTopology` (ADR-028):
  attached → attached_building, open → open_space (street on the cornerSide of a corner
  lot), unknown → unknown, front → street (`inferred`), rear → unknown. Toggle-sourced sides
  are `user_declared`, sides read from neighbour notes are `inferred`.
  Also `isExposableBoundary`, `attachedSides`.

### Group 3 — validator
- `validation/codes.ts`: `VALIDATOR_VERSION = "cv-1.0.0"`, `CONFLICT_CODES` (all 15 SRS
  §12.4 codes; `defaultSeverity`, `escalatesTo` for WARN/BLOCK codes, `messageKey`
  `conflicts.<CODE>`, `phase`), `CONFLICT_CODE_LIST`, `isConflictCode`.
- `validation/validateShot.ts`: `validateShot({ dna, shotIntent, extraPrompt?,
  approvedExceptions? }) → { verdict, issues, validatorVersion }`. `ShotIntent` P0 subset =
  `{ projectType, cameraId?, targetSpaceId?, targetDetailId? }`. Issue =
  `{ code, severity, path, messageKey, params, exceptionAllowed, accepted }`. Issues sorted
  BLOCK first, then code, then path. Also `verdictOf`, `warningCodes`, `detectPhrases`,
  `SHOT_RULES`.
  - `ADJACENT_BUILDING_CONFLICT`: camera `exterior_side` aimed at an attached side (or
    `exterior_rear` with attached rear) → issue at `cameras[i]`. An oblique
    `exterior_corner` camera is NOT an issue (the compiler already renders it as an oblique
    street view, ADR-028). Extra prompt: remove-neighbour phrases conflict when any meant
    side is attached; side-facade / corner phrases conflict when every meant side is
    attached. "Meant sides" = sides named in the text, else the camera's revealed side,
    else left+right. Confirmed evidence → BLOCK; inferred/unknown only → WARN (exception
    allowed).
  - `UNVERIFIED_GEOMETRY` (WARN): number + unit, "5 x 20", "exact dimensions", "kích thước
    chính xác", … unless the target/active space has a confirmed dimension fact.
  - `LOCKED_LIGHTING_CONFLICT` (BLOCK): `locks.lighting` + daytime (`morning|midday|
    afternoon`; interior shots read `interior.timeOfDay`; falls back to a daytime-looking
    `lighting.presetId`) + night/dusk phrase.
  - `SPACE_NOT_IN_BUILDING`, `OCCLUDED_TARGET`: registered hooks returning `[]` until P1.
  - Approved exceptions mark WARN issues `accepted` (verdict ignores them); BLOCK codes in
    `approvedExceptions` are ignored.
- `validation/phrases.ts`: vi (with/without diacritics) + en phrase sets, matched on
  lower-cased NFC text and on a folded copy (diacritics stripped, đ→d, same indices).
  Negation within three preceding words ("do not", "không", "đừng", …) cancels a match.
- i18n: `conflicts.<CODE>` (15 keys) and `conflictUi.{title,block,warn,allow,fix,
  approveException}` in `apps/desktop/src/i18n/en.ts` and `vi.ts` (accented); test in
  `apps/desktop/tests/i18n.test.ts`.

### Group 4 — PromptBundle provenance
- `PromptBundleSchema` gains optional top-level `validatorVersion`, `catalogVersion`,
  `sourceHash`, `configHash`, `resolvedWarnings` (optional so stored and hand-built bundles
  still parse). `compilePrompt` always sets them. `COMPILER_VERSION` stays `pc-1.6.0`;
  prompt text unchanged (pc-1.3.0 golden still equal after stripping the new fields).
- `prompt/hash.ts`: `canonicalJson` (sorted keys, no whitespace), pure-TS synchronous
  `sha256Hex` (checked against node:crypto), `canonicalHash` → `sha256:<hex>`.
  - `sourceHash` = canonical JSON of `{ dna (effective, after overrides), shot: { projectId,
    projectType, subtype, cameraId (resolved), references [{assetId, role, isAnchor}] } }`.
    Project name and reference labels are excluded.
  - `configHash` = `{ compilerVersion, validatorVersion, catalogVersion, knowledgePack }`.
  - `catalogVersion` = `NO_CATALOG_VERSION` ("none").
  - `resolvedWarnings` = WARN codes of `validateShot` on DNA + shot (no extra prompt).
  - `withResolvedWarnings(bundle, codes)` merges more codes (sorted, unique) for P0-B.
- Rust `dto::PromptBundle` gains the five fields as `Option` with
  `skip_serializing_if = "Option::is_none"`, so they survive the request snapshot verbatim
  and pre-P0 snapshots serialize exactly as before (test
  `prompt_bundle_keeps_adr_034_provenance_verbatim`).

## Con no (P0-B)

- Desktop gate (item 6): call `validateShot` before every paid submit (generate, variations,
  anchors, batch, enhance generative, region edit); BLOCK disables submit with
  `conflictUi.fix`, WARN offers `conflictUi.approveException`. Validate the extra prompt
  BEFORE `withExtraPrompt` (`apps/desktop/src/features/generate/extraPrompt.ts`,
  `store.ts submitGeneration`), then `withResolvedWarnings(bundle, accepted WARN codes)`.
- Put the verdict + accepted exceptions into the generation request snapshot and make the
  Rust backend refuse a BLOCK snapshot with `VALIDATION_ERROR` (+ Rust test). The snapshot
  field does not exist yet; `PromptBundle` only carries `resolvedWarnings`.
- Rust does not re-check the TS-only refines of `spaceCatalog` (unique ids, activeSpaceId
  exists) — add to `dna_validation.rs` if the backend must enforce them.
- UI must write `site` and keep `context.siteTopology` in sync (ADR-034; P1 editor).
- P1: real `SPACE_NOT_IN_BUILDING` / `OCCLUDED_TARGET`, `CATALOG_VERSION`, compiler
  `pc-1.7.0`.

## Lenh test

```
npm run verify
npx prettier --check .
npx vitest run packages/domain/tests/{extensions,site-adjacency,validation,prompt-provenance}.test.ts
cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy --offline --all-targets -- -D warnings && cargo test --offline dna
npm run schema:export   # after any ProjectDNA schema change; jsonSchema.test fails on drift
```

## Cam bay da gap

- Unaccented Vietnamese is ambiguous: "toi muon" = tôi muốn, "chieu toi" = chiếu tới,
  "lo hong" = lỗ hổng, "do" = because, bare "phải" = must, "dung" = dùng/đúng/đừng. Those
  are matched accent-only or not at all; extend phrase sets with a test per new phrase.
- "24mm lens" must not count as a dimension (explicit lookahead).
- A corner lot whose cornerSide toggle is `unknown` derives as `unknown`, not street,
  exactly per ADR-034 (the ADR-028 `cameraSitePlan` still treats it as corner_side).
- Reordering DNA cameras changes `sourceHash` (the DNA differs) though the prompt text does
  not; `compiler.test.ts` now asserts that explicitly.
- `z.unknown()` keys are optional in Zod 4 but required in the exported JSON schema; the
  fact `value` has a refine so TS never saves a fact Rust would reject.
