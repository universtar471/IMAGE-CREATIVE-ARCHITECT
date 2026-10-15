# wt/srs-p1b — Site visibility resolver, site editor, SITE & OCCLUSION section (ADR-034)

- Agent: claude (coder). Brief: `docs/agent-tasks/srs-p1b.md`. Not committed (as briefed).
- No Rust touched. The JSON schema did not change (`npm run schema:export` gives no diff).

## Goal

Visibility resolver, the `OCCLUDED_TARGET` rule, the `SITE & OCCLUSION` compiler section in
place of the ADR-028 party-wall wording, an occlusion-aware `describeCamera`, and the four-side
site editor that writes `dna.site` and the synced `context.siteTopology`. `COMPILER_VERSION`
is `pc-1.7.0`.

## Done

### Domain (`packages/domain/src`)

- `site/visibility.ts` (new): `resolveVisibility(adjacency, camera)` returns
  `{ visibleFacades, occludedFacades, warnings, confidence, feasibleCameraZones }`.
  - Facades: `front | left | right | rear | roof`. Zones: `front`, `front_left`,
    `front_right`, `left`, `right`, `rear_left`, `rear_right`, `rear`, `aerial`.
  - `requestedFacades(camera)`: which facades the angle points at. It follows the azimuth
    convention of `camera/describe.ts` (+45 is front-left, ±90 a side, ±180 the rear).
    Without an azimuth it uses the view type and the preset id. Roof is added for `aerial`
    or elevation ≥ 25°. Interior views request nothing.
  - Left, right and rear are visible only when they are `street` or `open_space`.
    `attached_building`, `boundary_wall` and `unknown` are occluded.
  - Interpretation: the front facade is the reference of the convention. It counts as
    visible unless it is itself `attached_building`. An unknown front or one that is not
    confirmed lowers confidence.
  - `warnings: { code, facade }[]`. Codes:
    - `attached_side_hidden`
    - `boundary_wall`
    - `side_unknown`
    - `evidence_unconfirmed`
    - `neighbour_height_unknown`
  - `confidence` is 0..1 with 2 decimals. It is capped at `MAX_VISIBILITY_CONFIDENCE = 0.9`
    because heights and setbacks are not modelled. For each requested side it is
    multiplied by:
    - 0.5 for `unknown`
    - 0.7 when the evidence is not confirmed
    - 0.9 for an occluding neighbour without `heightRelation`
  - A zone is feasible when at least one of its facades is exposable.
  - Helpers: `isFacadeExposable`, `cameraAzimuth`, `occludedSides`.
- `site/sync.ts` (new):
  - `siteTopologyFromSite(site)`:
    - `attached_building` → `attached`
    - `street` and `open_space` → `open`
    - `boundary_wall` and `unknown` → `unknown`; never `open`
    - A `street` left or right side sets `cornerLot` and `cornerSide`; left wins when both
      are streets.
  - `siteForEditing(dna)`: the stored site, or the four sides derived from the toggles.
  - `withSiteBoundary(site, side, { kind?, status? })`: a change of kind drops
    `neighborObjectId` and `heightRelation`.
- `prompt/sections/siteOcclusion.ts` (new):
  - `siteOcclusionLines(dna, camera, projectType, masterIndex)`: the heading
    `SITE & OCCLUSION PRESERVATION:` followed by lines, or nothing.
  - `siteCameraText`, `shotVisibility`, `SITE_OCCLUSION_HEADING`.
  - It is emitted for every exterior shot with a camera when any of these is true:
    - a side is attached
    - the camera reveals an unknown or walled side
    - a street side is visible
    - the shot is an aerial continuous block
  - It now applies without a master too; those lines are worded without "Image N".
- `prompt/compiler.ts`, three changes:
  1. The 30-line party-wall block is replaced by one `siteOcclusionLines(...)` call.
  2. The fallback camera paragraph and the aerial-block base use `siteCameraText`.
     `cameraSectionForPlan` gained an optional `base` argument for that.
  3. The version is now `pc-1.7.0`.

  The negatives and the oblique-street camera override are unchanged and still driven by
  `cameraSitePlan`.
- `camera/describe.ts`: new `describeCamera(camera, visibility?)`. `cameraSectionText(camera)`
  equals `describeCamera(camera)`, so output is unchanged without site knowledge. When a
  facade named by the azimuth is occluded:
  - attached or walled side: "front-left oblique view of the front facade only"
  - unknown side: "front-left oblique view centred on the front facade" (neither promised
    nor forbidden)
  - side view of a hidden side: "left-side viewpoint …; the left facade is not shown"
    ("not confirmed" for an unknown side)
  - aerial: "… of the front facade and roof only"
  - A composition that promises the hidden facade is replaced by "front facade dominant".
    Promises are "left side", "right facade", "rear elevation", "two facades" and similar.
    It is dropped when no facade is visible.
- `validation/validateShot.ts`: `OCCLUDED_TARGET` is now a real rule and is always WARN.
  - Camera: an `exterior_side` or `exterior_rear` camera whose target facade the resolver
    marks occluded.
  - Extra prompt: `SHOW_SIDE_PHRASES`, or the new `REAR_FACADE_PHRASES`, when every side it
    can mean is hidden.
  - Attached sides are left to `ADJACENT_BUILDING_CONFLICT`, so one request never raises
    both codes.
  - `REAR_FACADE_PHRASES` deliberately leaves out bare "phía sau" and "mặt sau" ("cây phía
    sau" only means "trees behind").

### Desktop (`apps/desktop/src`)

- `features/site/SiteAdjacencyEditor.tsx` (new):
  - Four sides, each with a kind select and an evidence select.
  - A convention hint: left and right as seen facing the front facade.
  - A "derived from the older settings" hint while `dna.site` is absent.
  - A small SVG plan with the front at the bottom and the viewer arrow below it.
  - Disabled when the project is read-only (archived) or `locks.context` is set.
- `features/site/siteEdit.ts` (new):
  - `writeSite`: `editDna("site")` then `editDna("context.siteTopology", synced)`.
  - `editSiteSide`.
  - `statusAfterKindChange`: picking a kind makes `unknown` or `inferred` evidence
    `user_declared`, and keeps `verified`. Picking `unknown` makes the evidence `unknown`.
- `ContextDnaPanel`: `SiteTopologyCard` (the ADR-028 toggles) is removed and replaced by
  `<SiteAdjacencyEditor />`.
- `SiteTopologyChip`: the camera chip's "Attached" and "Corner lot" now write both
  representations through `editSiteSide`. Before, they wrote only `siteTopology`, which the
  stored `site` would have overridden.
- i18n `site.*` in vi (with diacritics) and en. Unused `topology.*` keys are removed:
  - `title`, `left`, `right`
  - `cornerSide`, `attached`, `open`, `unknown`, `inferred`
- CSS `.site-editor` and `.site-plan`, with one column below 720 px.

## Prompt and golden changes (all deliberate)

- `test-vectors/legacy-compiler-pc-1.3.0.json` is **unchanged**. Those bundles have no
  camera, so the section never applies.
- `pc-1.6.0` → `pc-1.7.0` in `anchor-domain`, `interior`, `phase7` and
  `prompt-provenance` tests (version only).
- `compiler.test.ts` "adds a camera section right after context" and "describes aerial and
  interior cameras":
  - The villa pack declares no sides, so the left and right sides are `unknown`. The exact
    "front-left three-quarter view" text is therefore kept by declaring both sides `open`
    in the test.
  - A new test pins the unknown-side output: "front-left oblique view centred on the front
    facade", plus the "is not confirmed" site line.
- `validation.test.ts` "does not apply to interior shots or unknown sides": "show the side
  facade" with unknown sides went from ALLOW to `WARN:OCCLUDED_TARGET`, and still raises no
  `ADJACENT_BUILDING_CONFLICT`.
- `anchorTopology.test.tsx`:
  - The two toggle tests (the "Left side" open/attached select and the "Corner side"
    select) are rewritten for the editor. They cover the inferred attached side shown as
    `attached_building` / `inferred`, and a street side deriving the corner lot.
  - The interior test looks for the new title.
- Prompt behaviour that changes for real projects:
  1. Mid-block (both sides attached), front-left/right camera with a master: the old lines
     are all kept verbatim. They are followed by the SRS §5.2 lines "Use an oblique
     street-level viewpoint of the front facade only…" and "Preserve adjacent buildings…".
     The real `nhapho-dna.json` output was checked with `npx tsx`.
  2. The section now also appears for frontal cameras of attached houses, for aerials, and
     without a master. Before, it needed a master and an oblique camera pointed at the
     attached side.
  3. Unknown side: "The left side is not confirmed: do not invent a corner plot, side street
     or new neighbour arrangement, and do not present the left side as an exposed facade;
     show it only as a plain continuation consistent with Image 1." This is the old wording
     plus the non-claim.
  4. One attached side while the other lateral side is `open` or `street`: the party-wall
     line is scoped to the attached side ("do not expose a facade or windows on the left
     side…"). The old global "no side facade / no detached corner condition" contradicted
     a corner lot. When the other side is unknown or walled, the old global line stays
     verbatim.
  5. Camera paragraph: a three-quarter wording toward an unknown, walled or attached side
     is narrowed as described above. **Most visible effect:** a villa or resort with no
     declared sides no longer says "three-quarter view" for corner cameras until the user
     sets those sides to `open_space` or `street` in the editor.
  6. `resolvedWarnings` may now contain `OCCLUDED_TARGET` (side or rear cameras on unknown
     or walled sides; the derived rear is always `unknown`).
- Proof in `packages/domain/tests/site-visibility.test.ts`, "keeps every ADR-028
  constraint":
  - The test holds a verbatim copy of the pc-1.6.0 party-wall generator. It sweeps
    9 topologies × 5 cameras.
  - Every old line must be in the new preservation text verbatim, or match one of the two
    documented rewrites: the unknown-side clause set, or the scoped party wall, which is
    allowed only when the other side is `open`.
  - Another test shows that a DNA whose `site` comes from unchanged toggles
    (`siteForEditing`) compiles byte-identical positive, negative and preservation text.

## Debts and open points for the lead

- `VALIDATOR_VERSION` stays `cv-1.0.0` even though `OCCLUDED_TARGET` now fires. P0
  registered the code as a hook in cv-1.0.0. P1a adds `SPACE_NOT_IN_BUILDING`, so decide on
  one bump at merge.
- In `validation.test.ts`, the test title "SPACE_NOT_IN_BUILDING and OCCLUDED_TARGET return
  nothing until P1" is stale. Its assertion still holds for that input (a mid-block corner
  camera). I left it alone because P1a edits the same test.
- The subject framing (`viewTypeFraming`) still says "exterior three-quarter view" for
  `exterior_corner` cameras even when the side is hidden. This is pre-existing ADR-028
  behaviour, asserted in `anchor-domain.test.ts`. I did not change it to keep the compiler
  diff minimal. Candidate for pc-1.7.x: "exterior oblique view".
- `cameraSitePlan` (negatives, chips, the oblique override) still reads `siteTopology`. The
  editor and the chip keep it in sync, but a hand-edited DNA with a stale `siteTopology`
  could disagree with `site`. `siteTopology` cannot express the rear or `boundary_wall`
  (it maps to `unknown`).
- `heightRelation` and `neighborObjectId` are not editable in the UI yet. Without them,
  `neighbour_height_unknown` lowers confidence for every attached side.
- The `pc-1.6.0` strings in `apps/desktop/tests/conflictGate.test.ts` and
  `src-tauri/src/services/generations.rs` are static request fixtures, not version
  assertions. Left unchanged.
- Conflicts expected with P1a:
  - `COMPILER_VERSION`
  - `src/index.ts` exports
  - i18n files (my block sits right after `topology`)
  - `validation.test.ts`

## Test commands (from the worktree root)

- `npx vitest run --project domain`: 22 files, 321 tests. The baseline was 21 files and
  295 tests; `site-visibility.test.ts` is new.
- `npx vitest run`: 63 files, 709 tests.
- `npm run typecheck`, `npm run lint`, `npx prettier --check .`
- `npm run verify` (includes `cargo test`).

## Traps

- On this machine, a Python heredoc turned `\b` in regex literals into backspace
  characters. Edit TS regexes with the editor tool, not with scripts that hold escaped
  strings.
- The townhouse starter has no explicit toggles. Its attached sides are *inferred* from the
  "attached neighbouring townhouse" text, so the editor opens them as `inferred`.
- In tests, `nhapho-dna.json` keeps its attached-neighbour text. Setting
  `siteTopology.left = "unknown"` is still inferred as attached unless the text is cleared.
