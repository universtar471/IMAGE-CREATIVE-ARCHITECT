# SRS debts 2 — space, site and camera UX follow-ups (ADR-034, ADR-036)

**Branch:** `wt/srs-debts-2`. The items below were collected from the "NÊN SỬA" sections of `docs/agent-reviews/srs-p1a.md`, `srs-p1b.md`, `srs-p2a.md` and `srs-p2d.md`.

## Scope

1. **Space wizard: floor step and space facts.**
   - Add a floor step (`floorId`) between the archetype and group steps. It is optional, and the user may skip it.
   - Add an editor for `lockedElementIds`.
   - Add a small fact editor for placement facts used by scene objects: `driveway`, `hardscape`, `garage_bay`, and dimensions.
     - Each fact has an evidence badge: verified, user_declared or unknown.
     - With this in place, a villa yard with a verified driveway can accept a parked car (AC-07 style). Add a test for that path.
2. **Interior sync.**
   - When the active catalog space maps to an ADR-027 interior room (`spaceCatalog/mapping.ts`), set or suggest `interior.roomId` accordingly. Use the existing draft-DNA actions, and the interior panel remains the owner, so treat this as a one-click suggestion.
   - For an interior project whose active space is exterior (a garden, for example), the compiler must not emit the line "Interior space: … <bedroom>". Test it.
3. **Site editor.**
   - Make `heightRelation` (`lower | similar | taller | unknown`) editable per side.
   - The negative prompt and the camera chip read the resolved adjacency from `site` (via `resolveSiteAdjacency`) instead of `context.siteTopology`. Keep the output byte-identical for DNA whose `site` mirrors the toggles, and prove that with a test.
4. **Camera intent for interiors** (`packages/domain/src/camera/intent.ts`).
   - The `interior` flag uses the active space zone when one exists, and falls back to `dna.interior`.
   - `overview` and `approach` map to interior view types for interior shots: use the interior camera presets and view types that already exist in the code base.
   - Tests:
     - an interior project whose active space is a garden;
     - interior overview never yields `exterior_front`.

## Tests

Add a test for each item. AC-03 and AC-04 must stay green, as must the SRS §5.4 camera tests.

## Out of scope

- `packages/domain/src/{diagram,publishing}/**`, `features/{diagram,publishing}/**`
- Gate, retry and batch work, which belongs to debts-1.

## Done when

- `npm run verify` and `npx prettier --check .` pass.
- In `apps/desktop/src-tauri`, these pass: `cargo fmt --check`, `cargo clippy --offline --all-targets -- -D warnings`, `cargo test --offline`.
- If the DNA schema changes, run `npm run schema:export` and add a Rust validation test.
- `docs/agent-notes/srs-debts-2.md` is written.
- Do not commit. Do not touch `.env`.
