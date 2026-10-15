# SRS P1b — Site visibility resolver, site editor, SITE & OCCLUSION section (ADR-034)

**Branch:** `wt/srs-p1b`.

## Read first

- ADR-034 in `docs/DECISIONS.md`.
- `docs/plans/SRS_V7_2_UPGRADE_PLAN.md` §2 and §3.
- `docs/specs/MASTER_SPEC_SRS_1_0.md`: §5 (the §5.2 prompt core and the §5.4 tests) and §12.
- The P0 code:
  - `packages/domain/src/site/adjacency.ts`
  - `validation/*`, for the `OCCLUDED_TARGET` hook
  - `prompt/topology.ts`: `cameraSitePlan` and the ADR-028 party-wall wording
- `packages/domain/src/camera/`, for `describeCamera`.
- The current site topology toggles UI. Find where `context.siteTopology` is edited under `apps/desktop/src/features/`.

## Scope

### 1. Visibility resolver

Add `packages/domain/src/site/visibility.ts`:

`resolveVisibility(adjacency, camera) → { visibleFacades, occludedFacades, warnings, confidence, feasibleCameraZones }`, as specified in ADR-034.

- The facades are front, left, right, rear and roof.
- An attached side is never visible.
- A side is visible only when it is `street` or `open_space` and the camera azimuth or preset reveals it.
- Confidence is lower when a side is `unknown` or its evidence is not confirmed.
- Never claim exact visibility without heights or setbacks.
- Keep it pure and deterministic, with unit tests. Cover the SRS §5.4 cases that apply without P2.

### 2. Validator

Implement `OCCLUDED_TARGET` as a WARN rule driven by the resolver output. It fires when a camera or the extra prompt targets a facade the resolver marks occluded. Add tests.

### 3. Compiler

Add a `SITE & OCCLUSION` section in its own module, `prompt/sections/siteOcclusion.ts`.

- It replaces the ADR-028 party-wall wording with resolver output.
- If a DNA's site data is unchanged, the new section must keep every constraint the old wording expressed. Show this with tests.
- Set `COMPILER_VERSION` to `"pc-1.7.0"`. P1a sets the same value; the lead resolves that conflict and regenerates the goldens at merge.
- Hook the section into `compiler.ts` with as few lines as possible.
- Update the goldens on purpose, not as a side effect.

### 4. `describeCamera`

It must never promise a side facade that the resolver marks occluded. Add a test.

### 5. UI: site adjacency editor

- **Four sides.** Each side has:
  - a kind: `attached_building`, `street`, `open_space`, `boundary_wall` or `unknown`;
  - an evidence status.
- **Convention.** Use the viewer-facing convention: left and right as seen when facing the front facade. Include a small SVG plan diagram.
- **What it replaces.** It replaces the ADR-028 toggles. It writes both `dna.site` and the matching `context.siteTopology`, so older code paths keep working.
- **Read-only projects** cannot edit it.
- **Strings.** Vietnamese with full diacritics, plus English. The i18n tests must stay green.

### 6. Tests

- The resolver.
- The validator rule.
- The compiler section.
- `describeCamera`.
- The editor writing both representations.
- AC-03 and AC-04:
  - An attached townhouse never shows a side facade.
  - A corner lot shows only its street side.

## Out of scope

- The Space Catalog (P1a). Do not touch:
  - `packages/domain/src/spaceCatalog/**`
  - `knowledge/space-catalog/**`
  - `features/space/**`
- Context Library V4 (a later task, P1c).

## Done when

- `npm run verify` and `npx prettier --check .` pass.
- If you touch Rust:
  - `cargo fmt --check` passes.
  - `cargo clippy --offline --all-targets -- -D warnings` passes.
- `docs/agent-notes/srs-p1b.md` is written.
- Do not commit. Never touch `.env`. Make no paid API calls.
