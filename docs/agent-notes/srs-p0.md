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

---

## P0-B (desktop gate, snapshot, Rust refusal) — Agent: claude

### Da xong

- **Shared gate** `apps/desktop/src/features/validation/gate.ts` (pure): `checkShot({ dna,
  projectType, cameraId?, extraPrompt?, approvedExceptions? })` → `validateShot`;
  `canSubmit` (only ALLOW after accepted exceptions), `pendingWarnings`, `acceptedWarnings`,
  `validationSnapshot`, `withValidation(bundle, v)` (sets `bundle.validation` and merges the
  accepted codes with `withResolvedWarnings`), `conflictError` (BridgeError
  `VALIDATION_ERROR`, `details.validation`), `gateBatch(request, dna, projectType, approved)`
  (per item; non-ALLOW items dropped and returned in `skipped`).
- **Panel** `features/validation/ConflictPanel.tsx`: one `callout` listing issues
  (`conflicts.<CODE>` + source), BLOCK → `conflictUi.fix` ("Sửa lựa chọn"), pending WARN →
  `conflictUi.approveException` ("Duyệt ngoại lệ"); renders nothing when clean.
  `useConflictFix(textFieldId?, before?)`: text issues focus the field, camera issues open the
  Camera module, others Context. CSS: `.conflict-panel-body`, `.conflict-list`.
- **Store** (`app/store.ts`), the authority on persisted data:
  - `submitGeneration`: compiled path validates `bundle.dna` + extra prompt BEFORE
    `withExtraPrompt` (AC-22), refusal throws before `generation_submit`; run error carries
    `validation`. Prompt path (enhance, legacy resubmit) is gated on the persisted DNA too.
    `GenerationInput.approvedExceptions` added.
  - `createBatch(request, { approvedExceptions })`: gates every item, skips + toasts
    (`conflictUi.batchSkipped` / `batchAllBlocked`), never calls `batch_create` with nothing.
  - `GenerateDraft.approvedExceptions`; `setGenerateDraft` clears it when the extra prompt text
    changes (an approval belongs to the text it was given for).
- **Surfaces**: GeneratePanel (live check on draft DNA, button disabled with the reason),
  EnhancePanel (generative mode only; conservative is local), RegionPanel (instruction /
  material text checked like the extra prompt; region edit calls the bridge directly so it
  stamps the snapshot itself), BatchDialog (anchors + production: per-item panel, `batch`
  hint, submit disabled only when no item may be sent). Variations ("Generate again"),
  ContactSheet re-run, Mood variation batch and Enhance batch go through `submitGeneration`
  / `createBatch`, so they are gated without their own panel.
- **Snapshot shape** (`PromptBundle.validation`, optional):
  `{ verdict: "BLOCK"|"WARN"|"ALLOW", validatorVersion, issueCodes: string[],
  approvedExceptions: string[] }` — `verdict` is AFTER accepted exceptions, so a gated
  submit always records ALLOW; `issueCodes` keeps every issue found (accepted included).
  TS `ShotValidationSnapshotSchema` in `schemas/prompt.ts`; Rust `dto::ShotValidationSnapshot`
  + `ShotVerdict` enum (unknown verdict = invalid request), `Option` +
  `skip_serializing_if`, so old snapshots serialize unchanged. Placed in the prompt bundle
  because that is the verbatim request snapshot for both `generation_submit` and batch items.
- **Rust**: `generations::validate` → `ensure_not_blocked` (VALIDATION_ERROR, details
  `{ issueCodes }`), so `batch_create` items are refused too (all-or-nothing). The
  conservative-enhance empty bundle keeps `validation`. Missing field = accepted as before.
- **Mock backend**: same BLOCK refusal in `validateRequest`; schema keeps the field.
- **dna_validation.rs**: `validate_space_catalog` — duplicate space id →
  `spaceCatalog.spaces.<i>.id`, unknown `activeSpaceId` → `spaceCatalog.activeSpaceId`.
- **Corner lot fix**: `cameraSitePlan` now checks `unknown` before the cornerSide, so an
  unknown cornerSide is `unknown_side` (not `corner_side`), agreeing with
  `resolveSiteAdjacency`. No golden changed (all corner fixtures declare the side `open`).
- i18n (en + vi with diacritics): `conflictUi.{accepted, fromExtraPrompt, fromCamera,
  refusedBlock, refusedWarn, batchSkipHint, batchSkipped, batchAllBlocked}`.
- API_CONTRACTS §9: one bullet for the BLOCK refusal.

### Tests added

- `apps/desktop/tests/conflictGate.test.ts` (8): AC-22 vi + en blocked at store level with
  `generation_submit` never sent (even with the code in approvedExceptions); WARN refused,
  then accepted → queued, stored snapshot `{ALLOW, issueCodes, approvedExceptions}` +
  `resolvedWarnings`, extra prompt appended after the check; clean submit stamps ALLOW;
  approvals cleared on new text; batch skips the BLOCK side-camera item and reports it; all
  blocked → no `batch_create`; mock refuses a BLOCK snapshot.
- `apps/desktop/tests/conflictGateUi.test.tsx` (2): Generate button disabled + "Fix" focuses
  the extra prompt; WARN approve enables, new text re-arms.
- `packages/domain/tests/site-adjacency.test.ts`: unknown cornerSide agreement.
- Rust: `generations::block_verdict_snapshot_is_refused_with_validation_error`,
  `prompt_bundle_keeps_adr_034_provenance_verbatim` (extended: validation roundtrip, bad
  verdict), `batches::refuses_a_batch_item_whose_snapshot_is_blocked`,
  `dna_validation::enforces_unique_space_ids_and_an_existing_active_space`.

### Con no

- `job_retry` re-runs a stored snapshot without re-validating against the current DNA (it
  passed the gate when first submitted). Re-gate if the DNA may have changed since.
- Batches from ContactSheet re-run, Mood variations and Enhance batch have no panel: a WARN
  item there is skipped with a toast (no way to approve). Only camera-based WARNs can occur
  in P0 (inferred attached side + side/rear camera), so this is rare.
- The compiler still fills `resolvedWarnings` with the DNA-level WARN codes by itself
  (P0-A). Harmless because the gate refuses any unaccepted WARN, but the field mixes
  "found" and "accepted" until the compiler stops pre-filling it.
- The Generate panel always validates with `cameraId: null` (it has no camera selector);
  camera rules apply to batches.
- Rust trusts the client's verdict; it does not re-run the validator (TS-only, P0 by design).

### Cam bay

- Camera ids in DNA fixtures must be `CAM_<ULID>`: a made-up id makes `project_get` fail
  the response parse ("unexpected response"), which looks like a store bug.
- `PromptBundleSchema` strips unknown keys: without the schema field the mock and every
  parsed `GenerationDTO` silently drop `validation`.
- Region edit bypasses `submitGeneration` (direct `generation_submit`), so its gate lives in
  `RegionPanel.submit`.

### Lenh test (P0-B)

```
npx vitest run apps/desktop/tests/conflictGate.test.ts apps/desktop/tests/conflictGateUi.test.tsx packages/domain/tests/site-adjacency.test.ts
cd apps/desktop/src-tauri && cargo test --offline block_verdict && cargo test --offline space_ids && cargo test --offline blocked
```
