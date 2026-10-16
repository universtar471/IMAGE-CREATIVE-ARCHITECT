# wt/srs-debts-2 — space, site and camera UX follow-ups (ADR-034, ADR-036)

- Agent: claude (coder)
- Branch: `wt/srs-debts-2`, from main `cc27fdb`
- Brief: `docs/agent-tasks/srs-debts-2.md`
- Not committed, as the brief asks.

## Goal

Clear the "NÊN SỬA" items of the srs-p1a, p1b, p2a and p2d reviews:
- space floor step and space facts
- interior room sync
- site height relation and site-driven camera plan
- interior camera intents

## Done

### 1. Space wizard (`features/space/SpaceSelector.tsx`)

**Floor step.** The step sits between the building type and the group, and is optional (empty means skip).
- Ids come from `spaceFloorOptions(building.floors, current)` in `spaceCatalog/floors.ts`: `basement`, `floor_1` … `floor_N`, then `roof`. N defaults to 5 when the floor count is not set.
- A stored id outside the list stays selectable.
- A new space is created on the chosen floor. An existing space is reused only when both preset and floor match.
- Changing the floor while a space is active moves that space.
- The floor is not compiled.

**Locked elements.**
- Chips over `lockableElements(preset)` in `spaceCatalog/resolve.ts`:
  - `LOCKABLE_SPACE_ELEMENTS`: walls, columns, stairs, doors and windows for every space; flooring, ceiling and built-in furniture for interiors; paving, boundary walls and trees outside
  - plus the preset's optional items
- A tag field for other free ids.
- The built elements have vi/en labels. Optional items show their English prompt text, as the approvals already did.
- SPACE SCOPE adds one line when the list is not empty: `Locked elements, kept exactly where and as they appear in the approved references (do not move, restyle or remove them): …`. Catalog wording is used, or the id with `_` and `-` turned into spaces.

**Placement facts.** `placementFactsFor(preset)` and `SPACE_PLACEMENT_FACTS` live in `sceneObjects/allowed.ts`.
- A villa yard gets `driveway` and `hardscape`; a garage gets `garage_bay`. Other spaces get none.
- Each fact is a checkbox. Ticking it writes `{ value: true, evidence: user_declared }`; unticking removes it.
- A present fact shows an evidence badge: verified, user_declared or unknown.
- The dimension badge now offers the same three statuses (it offered verified, unknown and inferred before). A stored `inferred` dimension simply shows no pressed badge.
- With this, a villa yard with a verified (or declared) driveway accepts a parked car. Unknown evidence gives a WARN, and no fact gives a BLOCK. There is a domain test and a UI test for that path.

### 2. Interior sync

- `suggestInteriorRoom(dna)` in `spaceCatalog/mapping.ts` suggests the ADR-027 room of the active interior space when:
  - the room exists in `INTERIOR_ROOM_BY_PRESET`
  - the building use offers it
  - it is not already chosen
- The SpaceSelector shows "Phòng nội thất tương ứng: … [Dùng cho DNA nội thất]". One click runs `editDna("interior.roomId", room)`. The button is disabled when the project is read-only or the building is locked, as the room select is.
- Compiler: for an interior project whose active space is exterior or semi-outdoor, the `form` section ("Interior space: …") is dropped. The furnishing line was already dropped. Tested with a garden, where the master bedroom is not mentioned.

### 3. Site editor and the site-driven plan

- `SiteAdjacencyEditor` shows a "Chiều cao …" / "… neighbour height" select for sides whose kind is `attached_building` or `boundary_wall` (`sideHasHeightRelation`). An empty value removes `heightRelation`.
- `withSiteBoundary` and `editSiteSide` take `heightRelation` (`null` removes it). Another edit keeps the value, and a kind change still clears it.
- `HEIGHT_RELATIONS` is exported, and the schema enum is unchanged.
- New `site/plan.ts` has `topologyFromAdjacency` and `siteCameraPlan(camera, dna, projectType)`. It folds `resolveSiteAdjacency` back to the toggle vocabulary and calls `cameraSitePlan` with explicit values only.
- The plan is now read this way by:
  - the compiler: contextual negatives and the camera section
  - SITE & OCCLUSION
  - `SiteTopologyChip`
  - the BatchDialog's unresolved-camera list
- `siteTopologyFromSite` now reuses `topologyFromAdjacency`, with the same mapping.
- Proof test (`srs-debts-2.test.ts`): five toggle set-ups × townhouse and villa × every camera × with and without a master. Each compiles the same positive, negative and preservation text with toggles only and with `site = siteForEditing(toggles)`, and the plan equals `cameraSitePlan` on the toggles.
- A second test shows that a verified `site` overrides contradicting toggles in the prompt and in the chip.

### 4. Camera intent (`camera/intent.ts`)

- `isInteriorShot(dna, zone?)`: the active space zone decides when there is one, otherwise `dna.interior`. `availableIntents` uses it, so an interior project with a garden active offers aerial again.
- For interior shots:
  - `overview` → `interior_wide`, 20 mm, "wide view from the entrance showing the whole room"
  - `approach` → `interior_wide`, 24 mm, "one-point perspective facing the main wall"
  - `detail` → `interior_detail`, "close-up material and furniture detail"
- These wordings come from the ADR-027 interior camera presets (`CAMERA_PRESETS`).
- `suggestedCameraViewType(intent, dna?)` takes the DNA optionally.

### Versions and docs

- `COMPILER_VERSION` `pc-1.8.0` → **`pc-1.9.0`**. Prompt text changes for some existing inputs:
  - interior + exterior active space: the form line is dropped
  - a non-empty `lockedElementIds` now compiles
  - an explicit `site` that disagrees with the toggles now drives the negatives and camera text
- No golden text changed. The 8 domain test files that pin the version string were updated, with no prompt-text changes: `anchor-domain`, `effects`, `interior`, `phase7`, `prompt-provenance`, `scene-objects`, `site-visibility`, `space-catalog`.
- `VALIDATOR_VERSION` and `CATALOG_VERSION` are unchanged.
- The DNA schema is unchanged. `npm run schema:export` produced no diff, so no Rust test was added.
- `docs/DECISIONS.md`: ADR-034 amendment 4 and ADR-036 amendment 2.
- i18n (vi with diacritics, en): `spaceSelector.floor*`, `placementFact*`, `factEvidence`, `locked*`, `lockable.*`, `roomSuggestion`, `applyRoom`, `evidenceStatus.user_declared` (the unused `inferred` key was removed), `site.heightFor.*`, `site.heights.*`.
- CSS: `.space-fact-row` and `.space-room-suggestion`.

## Tests

- New `packages/domain/tests/srs-debts-2.test.ts`: 13 tests.
- New `apps/desktop/tests/srsDebts2.test.tsx`: 10 tests.
- `apps/desktop/tests/spaceSelector.test.tsx`: the badge names were updated ("Người dùng khai báo" / "Declared by user" instead of "Theo ảnh tham chiếu" / "From reference images").
- AC-03, AC-04, AC-07 and the §5.4 camera tests stay green.

Commands (worktree root):

```
export CARGO_TARGET_DIR=F:/cargo-targets/srs-debts-2
npm run verify                # 83 files / 1008 vitest tests, cargo test 318 passed (6 ignored)
npx prettier --check .
cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy --offline --all-targets -- -D warnings && cargo test --offline
```

## Still open

- `floorId` is stored but not compiled, and the spaces of other floors are not listed. The wizard edits only the active space.
- For interior shots, `front`, `street_oblique` and `pedestrian` still suggest exterior view types. The brief only covered `overview` and `approach`, and `detail` was added.
- Placement facts are booleans only. There is no surface size per driveway, and the parking capacity check uses the space's width and depth.
- Locked elements are prompt-only. The validator has no collision or occlusion check against them (SRS §7.2, P2d debt).
- The height relation is shown only for attached neighbours and boundary walls. A `heightRelation` already stored on another kind is kept but not editable.
- Not checked in the running app (no `tauri dev` / browser session). The UI is covered by the jsdom tests only.

## Pitfalls

- Python `open(..., "w")` on Windows writes CRLF. Prettier and git then complain, so these files were normalised back to LF.
- `cameraSitePlan` on the toggles reads free-text "party wall" hints when a toggle is `unknown`. `siteCameraPlan` passes explicit values only. A `site` side marked `boundary_wall` therefore stays `unknown` and is never re-inferred as attached. This is intended: `site` wins.
