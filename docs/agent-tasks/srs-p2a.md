# SRS P2a — Visual camera intent (ADR-036)

**Branch:** `wt/srs-p2a`.

## Read first

- ADR-036 and ADR-034 in `docs/DECISIONS.md`
- `docs/plans/SRS_V7_2_UPGRADE_PLAN.md` §3
- SRS §5.1 and §5.4 in `docs/specs/MASTER_SPEC_SRS_1_0.md`
- `packages/domain/src/camera/*`
- `packages/domain/src/validation/*` (`ShotIntent`)
- `packages/domain/src/site/*` (read only)
- `apps/desktop/src/features/camera/*`
- `features/generate/*`
- `features/validation/gate.ts`

## Scope

### 1. Domain: `packages/domain/src/camera/intent.ts`

Add the visual intent schema:

- `view`: `front | street_oblique | pedestrian | overview | approach | detail | aerial`
- `purpose`: `landscape | portrait | square`
- optional custom sliders, each `0..100`: `distance`, `height`, `focus`

Add `availableIntents(dna, spaceZone?)`:

- Interior spaces never offer `aerial` or roof views.
- Attached townhouses never offer side-reveal options.
- Use `resolveSiteAdjacency`.

Add `resolveVisualIntent(intent, dna) → Partial<CameraDNA>`:

- It returns suggested `viewType`, `presetId`, aspect and lens bucket.
- It never invents measured distance, height or azimuth values.

The tests must cover these SRS §5.4 cases:

- A bedroom has no roof or drone preset.
- An attached townhouse with `front-left` never yields "two exposed façades".
- Switching Simple → Expert → Simple keeps the original `CameraDNA` unchanged.

### 2. ShotIntent

- Add optional `visualIntent` to the `ShotIntent` type, plus a Zod schema for it.
- Add the optional `PromptBundle.shotIntent` (TS schema and Rust DTO `Option`, `skip_serializing_if`), as ADR-036 describes.
- Add a Rust test that a snapshot with it roundtrips verbatim.

### 3. UI: `features/camera/VisualIntentSelector.tsx`

- Picture cards answer "Bạn muốn nhìn gì?". Then ask "Ảnh dùng để làm gì?".
- Three levels:
  - Dễ dùng (default)
  - Tùy chỉnh (sliders)
  - Chuyên gia (the existing `CameraDirector`)
- Wire it into the camera and generate flow so the chosen intent goes into the ShotIntent kept in the workspace store per project. It is never written into the DNA.
- The generate submit passes the ShotIntent into the bundle snapshot.
- Read-only projects cannot edit.
- i18n: vi with full diacritics, plus en.

### 4. Compiler

No new section is needed. If the intent changes camera wording, do it through the existing `describeCamera` input, and prove that the output without an intent is unchanged.

## Out of scope

Do not touch these; other branches own them:

- `packages/domain/src/{detail,effects,sceneObjects,contextLibrary,spaceCatalog}/**`
- `features/{detail,effects,sceneObjects,enhance}/**`

## Done when

- `npm run verify` and `npx prettier --check .` are green.
- In `apps/desktop/src-tauri`, these pass:
  - `cargo fmt --check`
  - `cargo clippy --offline --all-targets -- -D warnings`
  - `cargo test --offline`
- `docs/agent-notes/srs-p2a.md` is written.
- Do not commit. Do not touch `.env`. Do not make paid calls.
