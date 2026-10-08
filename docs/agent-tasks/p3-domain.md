# P3-B — Domain: camera presets, camera prompt compilation, batch builders

Branch `wt/p3-domain`, based on `wt/p3-base`. Before you start, read:
- `tasks/PHASE_03.md`
- ADR-008 and ADR-016…018
- `docs/API_CONTRACTS.md` §10
- the contract files listed in PHASE_03

You own `packages/domain/**` and `knowledge/**`.
- Contract shapes may be extended (new optional fields). Do not rename or remove fields; a needed change goes in your note.
- If you change any DNA schema, re-export the JSON Schema (`npm run schema:export`).

## Scope

1. **Camera presets**
   - Add `cameraPresets` to every pack in `knowledge/`: 4–7 presets each.
   - Every pack needs at least 2 presets with `anchorRecommended`.
   - Exterior types: front, front-left corner, front-right corner, street-level, aerial 3/4, rear or garden, and a detail shot where relevant.
   - Interior packs: wide from the entrance, opposite corner, detail.
   - Values are realistic architectural photography: eye height ~1.6 m, lens 24–35 mm exterior and 16–24 mm interior, aerial elevation 25–40°.
   - Resolution and fallback behave as for other pack content; add tests.

2. **Camera helpers** (pure, tested):
   - `newCameraId()` — `CAM_` + a ULID from `crypto.getRandomValues`, Crockford base32, time-ordered
   - `cameraFromPreset(preset, existingNames)` — unique name
   - `blankCamera()`
   - `anchorViews(dna)`
   - `cameraReadiness`, used by the UI to explain missing data
   - Validation messages for the camera fields; extend `validateProjectDNA` if needed.

3. **Prompt compiler** (bump `COMPILER_VERSION` to `pc-1.1.0`):
   - `PromptCompileInput` gains an optional `cameraId`. When it is set and the camera exists, add a camera section in the defined section order (ARCHITECTURE §7, "camera" after context): view type, viewpoint (azimuth/elevation in words, e.g. "front-left three-quarter view from eye level"), lens feel, distance, composition, notes.
   - `PromptReference` gains an optional `isAnchor: boolean`. An anchor reference gets its own instruction: it is the approved view for this camera, so match its viewpoint, framing and design exactly, while the master stays authoritative for the architecture. Order it right after the master.
   - Keep determinism and order independence. Update the existing tests and add new ones.

4. **Batch builders** (pure, tested):
   - `buildAnchorBatchItems(input)` — one item per anchor view, using the master as the reference.
   - `buildProductionBatchItems(input, cameraIds, anchors)` — per camera: master, then that camera's anchor, then the selected other references, capped at `maxReferenceImages` with the master and anchor never dropped.
   - Both use `compilePrompt` per item. Params default from the camera's `aspectRatio` when the model offers it.

5. **Fix the domain tests broken by the base contract change** (`tests/generation.test.ts`).

## Done when

- `npx vitest run --project domain`, `npm run typecheck -w @arch/domain`, `npm run lint` and `npx prettier --check packages knowledge` all pass.
- `docs/agent-notes/p3-domain.md` is written and committed.
- You commit in small steps.
- Your final report lists every exported function signature the UI will call.
