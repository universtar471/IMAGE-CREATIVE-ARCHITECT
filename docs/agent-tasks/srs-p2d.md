# SRS P2d — Scene objects and car library (ADR-036)

**Branch:** `wt/srs-p2d`.

## Read first

- In `docs/DECISIONS.md`: ADR-036 and ADR-034.
- In `docs/plans/SRS_V7_2_UPGRADE_PLAN.md`: §3.
- In the SRS: §7.1 and §7.2, plus AC-06 and AC-07.
- In `packages/domain/src/`:
  - `spaceCatalog/*`, for the active space and its zone and category. Read only.
  - `regions/schemas.ts`, for `SceneSchema`.
  - `site/*`, read only.
  - `validation/*`
  - `prompt/sections/*`
- In `apps/desktop/src/features/`: `generate/*` and `validation/gate.ts`.

## Scope

1. **Domain:** `packages/domain/src/sceneObjects/`
   - **Object catalog.** Types: `person`, `car`, `motorbike`, `bicycle`, `plant`, `pet`.
     - Each car preset has an English prompt description and a Vietnamese label.
     - Every car is labelled "mô phỏng theo mẫu xe".
     - Include a trademark warning for commercial publishing.
   - **Car presets:**
     - `car.mercedes_300sl.gullwing` (coupe). The roadster is a separate preset; never mix the two.
     - `car.shelby_cobra.1964_289`. Never render it with the later 427 body.
     - `car.jaguar_e_type.series1_coupe`
     - `car.jaguar_e_type.series1_roadster`
     - Generic groups: modern luxury sedan, SUV, EV, Vietnamese city car.
     - Also motorbike and bicycle.
   - **`SceneObjectRequest`**, per ADR-036:
     - `presetId`, `quantity`
     - `targetSpaceId`, `placementZoneId`
     - `state`: `static | moving`
     - `appearanceOverrides`, `visibility`, `sourceReferenceIds`
   - **Allowed table** per space, built from the space catalog's `zone`/`category`/id plus the SRS §7.1 table:
     - Bedrooms and living rooms: people, pets and plants. No cars or motorbikes.
     - Townhouse facade: people, and vehicles only on the existing road. Never a new garage or parking pad.
     - Garage or driveway: cars, motorbikes and people, when there is enough room.
     - Villa yard: parked cars on hardscape only.
     - Resort pool: people only. No vehicles.
     - Hotel lobby: people and plants.
   - **`ObjectPlacementValidator` rules** (register them in the single validator):
     - `OBJECT_NOT_ALLOWED_IN_SPACE` (BLOCK). Example: a classic car in a bedroom (AC-06).
     - `OBJECT_NO_PLACEMENT_ZONE`:
       - BLOCK when there is no plausible zone, for example a car with no verified driveway or garage.
       - WARN when the zone is plausible but unverified.
     - A verified garage with a 300 SL is allowed (AC-07).
     - Never create a driveway.
   - With no objects selected, the module adds nothing.
2. **ShotIntent and snapshot**
   - Add optional `sceneObjects: SceneObjectRequest[]` to `ShotIntent`.
   - If `PromptBundle.shotIntent` does not exist yet, add it as an optional field in both TS and the Rust DTO. The lead resolves conflicts with P2a and P2b.
3. **Compiler**
   - Add a `SCENE OBJECTS` section in `prompt/sections/sceneObjects.ts`, following the SRS §7.2 example: one line per object request, with "if adequate clearance" wording for unverified zones.
   - Set `COMPILER_VERSION` to `"pc-1.8.0"`.
   - Output with no objects must stay unchanged apart from the version string.
4. **UI:** `apps/desktop/src/features/sceneObjects/`, the flow from SRS §7.1:
   - target space → allowed categories → preset → quantity → zone → static or moving → preview with warnings
   - Options that are impossible are hidden or disabled, with the reason shown.
   - Selections go into the per-project ShotIntent in the workspace store, never into the DNA.
   - Submitting goes through the conflict gate.
   - i18n: Vietnamese with full diacritics, plus English.

## Out of scope

Do not touch:
- `camera/intent.ts`
- `packages/domain/src/{detail,effects,contextLibrary,spaceCatalog}/**`, except for reading them
- `features/{detail,effects,enhance,space}/**`

## Done when

- `npm run verify` and `npx prettier --check .` pass.
- In `apps/desktop/src-tauri`, these pass:
  - `cargo fmt --check`
  - `cargo clippy --offline --all-targets -- -D warnings`
  - `cargo test --offline`
- `docs/agent-notes/srs-p2d.md` is written.
- Do not commit. Do not touch `.env`. Make no paid calls.
