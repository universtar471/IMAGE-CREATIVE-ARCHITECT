# wt/srs-p2d — SRS P2d: scene objects and car library (ADR-036)

- Agents: Codex (first pass, stopped by provider credit), Claude Code (merge of `main`, review, rewrite, finish).
- Branched from `main`; `main` (P1b site visibility, P1c context library) merged in, conflicts resolved, merge left uncommitted for the lead.

## Merge resolution

- Conflicts in `conflictGate.test.ts`, `domain/src/index.ts`, `validation/codes.ts`, `interior.test.ts`, `validation.test.ts`: kept both sides. `index.ts` exports both `./sceneObjects` and `./contextLibrary`; versions use the higher values (`pc-1.8.0`, `cv-1.2.0`). `CONFLICT_CODES` auto-merged with `OCCLUDED_TARGET` (P1b) and the P2 codes.
- `site-visibility.test.ts` (from main) pinned `pc-1.7.0`; updated to `pc-1.8.0`.

## Done

- **Domain `packages/domain/src/sceneObjects/`**
  - `schemas.ts`: `SceneObjectRequest` = `presetId`, `quantity` (1–20), `targetSpaceId`, `placementZoneId?` (enum `PLACEMENT_ZONE_IDS`), `state` (`static|moving`), `appearanceOverrides?` (`{ color?: ObjectColorId }`, a fixed colour list, so no free text reaches the prompt), `visibility?` (`foreground|midground|background`), `sourceReferenceIds` (default `[]`).
  - `catalog.ts`: 19 presets over the six types. Cars: `car.mercedes_300sl.gullwing`, `car.mercedes_300sl.roadster` (separate preset, never mixed), `car.shelby_cobra.1964_289` (prompt excludes the 427 body), `car.jaguar_e_type.series1_coupe`, `car.jaguar_e_type.series1_roadster`, generic `car.generic.{modern_luxury_sedan,suv,ev,vn_city_car}`; plus motorbike (scooter, underbone) and bicycle. Every car has `simulatedModel: true` (UI label "mô phỏng theo mẫu xe"); the 5 branded ones have `trademarkWarning: true`.
  - `allowed.ts`: space kind from the catalog zone/category plus a few stable preset ids (garage, pool, hotel/resort lobby, townhouse front yard); the SRS §7.1 table `SCENE_OBJECT_TABLE` (allowed zones per type, default first); `SITE_FRONTAGE_TARGET = "site.frontage"` for exterior shots (street frontage, road from the site front boundary); `placementZoneStatus` → `verified | plausible | absent`.
  - `placement.ts`: `validateObjectPlacement` / `ObjectPlacementValidator`, registered once in `SHOT_RULES` of `validateShot`.
    - `OBJECT_NOT_ALLOWED_IN_SPACE` BLOCK: type not allowed in the space kind (AC-06), unknown preset, unknown target (frontage on an interior shot counts as unknown).
    - `OBJECT_NO_PLACEMENT_ZONE` BLOCK: zone not valid for the type there, zone absent from project data (no driveway fact / no street front), vehicle moving outside `existing_road`, measured garage too small (bay 2.5 × 5 m per car; requests sharing a bay add up). WARN: zone recorded but unconfirmed (unmeasured garage, inferred driveway fact, inferred street front).
    - A verified garage (confirmed `widthM`+`depthM`, or confirmed fact `garage_bay`) with a 300 SL is ALLOW (AC-07). Nothing creates a driveway.
- **ShotIntent** moved to `validation/shotIntent.ts` (type + `ShotIntentSchema`, re-exported from `validateShot`) to keep `schemas/prompt.ts` from importing the validator. `PromptBundle.shotIntent` optional in TS; Rust `ShotIntent` / `SceneObjectRequest` / `SceneObjectState` DTOs, all options `skip_serializing_if`, plus `#[serde(flatten)] extra` so fields of P2a/P2b are not dropped before their typed fields land.
- **Compiler**: `prompt/sections/sceneObjects.ts` (`SCENE OBJECTS:` heading, one line per accepted request, "only if the … is present in the approved references and has adequate clearance" for unverified zones, parked-static and no-new-driveway lines). Placed after the camera section (SRS §12.2 item 7). Refused requests are never compiled. `normalizeShotIntent` drops empty choices: with no objects the bundle (prompt, hashes, no `shotIntent`) is identical to before except the version. `sourceHash` includes the shot intent only when present.
- **Desktop**: `features/sceneObjects/SceneObjectsPanel.tsx` (module `scene_objects`): target space (catalog spaces + frontage for exterior) → category chips (impossible ones disabled, reason shown) → preset (cars labelled "mô phỏng theo mẫu xe", trademark callout) → quantity → zone (status shown; absent zones disabled with "never creates a driveway" hint) → static/moving (moving disabled with reason) → colour / prominence → preview list with validator issues and the exact prompt lines. Writes only `workspace.shotIntent` via `setShotIntent`; the store keeps it per project for the session (restored on reopen). Gate: `checkShot` lets the project type and camera win over stored values; the retry/resend path validates with the snapshot's own `prompt.shotIntent`. Generate preview, Prompt preview and the Camera preview compile with the shot intent. i18n `sceneObjects.*` in vi (full diacritics) and en.

## Tests

- `packages/domain/tests/scene-objects.test.ts` (25): catalog/presets, allowed table, AC-06, AC-07, unverified WARN, capacity, villa yard (absent/inferred/verified driveway, lawn, moving), frontage (verified/inferred/wall/interior), pool, lobby, unknown ids, purity, compiler (unchanged without objects, exact AC-07 lines, clearance wording, refused not compiled, people/pets, determinism + snapshot).
- `apps/desktop/tests/sceneObjects.test.tsx` (7): UI flow AC-06/AC-07, absent zone, English switch, gate BLOCK before any bridge submit, ALLOW submit snapshots `prompt.shotIntent` and keeps it out of the DNA, restore on reopen.
- Rust `prompt_bundle_keeps_the_shot_intent_verbatim`.

Commands (worktree root): `CARGO_TARGET_DIR=F:/cargo-targets/srs-p2d npm run verify` (779 vitest + 287 cargo, green), `npx prettier --check .`, in `apps/desktop/src-tauri`: `cargo fmt --check`, `cargo clippy --offline --all-targets -- -D warnings` (clean).

## Debts

- No UI writes zone facts (`driveway`, `hardscape`, `garage_bay`): the space wizard (out of scope, `features/space`) only edits dimensions. Today a villa-yard car is BLOCKed unless such a fact exists in the data; a garage is verified through its measured width/depth. The space wizard should offer those facts (it owns `dna.spaceCatalog`).
- Showroom / special display exceptions of SRS §7.1 (cars in an interior) are not modelled; cafe/restaurant rows have no catalog archetype yet.
- `sourceReferenceIds` is in the schema and snapshot but the panel has no picker yet, and the compiler does not reference it.
- Collision with locked elements / scale checks beyond garage capacity are not implemented (SRS §7.2 "chặn va chạm, lệch tỷ lệ, che cấu kiện khóa"); the prompt only states them.
- The shot intent lives in memory per session (not persisted across app restarts), as ADR-036 asks for a workspace-store value.
- Not checked visually in the running app; covered by jsdom tests only.

## Traps

- `PlacementZoneId` is an enum; old Codex snapshots with free-text zones would fail `ShotIntentSchema` (none were ever submitted).
- `schemas/prompt.ts` must import `ShotIntentSchema` from `validation/shotIntent.ts`, not `validateShot.ts` (import cycle risk).
- Rust writes `cameraId: null` back as absent; the TS schema treats both the same.
- P2a/P2b/P2c also add `ShotIntent` fields / sections at `pc-1.8.0` / `cv-1.2.0`. `normalizeShotIntent` keeps every field except unset/empty ones and always overwrites `projectType`/`cameraId`; the store's `setShotIntent` treats the intent as empty only when `sceneObjects`, `targetSpaceId` and `targetDetailId` are all unset (extend that check for new fields).
