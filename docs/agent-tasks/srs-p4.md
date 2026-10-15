# SRS P4 — Diagram Studio MVP (ADR-037)

**Branch:** `wt/srs-p4`.

## Read first

- ADR-037 and ADR-034 in `docs/DECISIONS.md`.
- SRS §10, AC-14 and AC-15 in `docs/specs/MASTER_SPEC_SRS_1_0.md`.
- `packages/domain/src/{site,spaceCatalog,facts}/*`. Read these only; do not change them.
- `apps/desktop/src/features/workspace/modules.ts`.
- `features/generate/*` and `features/validation/gate.ts`.
- The asset import bridge calls in `apps/desktop/src/lib/*`.

## Scope

### 1. Domain: `packages/domain/src/diagram/`

Implement exactly what ADR-037 specifies:

- schemas
- `planDiagram`
- `layoutDiagramSheet`, which returns an SVG string

Rules:

- Text, arrows and labels are vector, with Vietnamese and English variants.
- One fixed palette and one fixed frame geometry.
- Output is deterministic.
- Steps that are not verified carry the label "sơ đồ diễn giải ý tưởng".

Tests:

- AC-14: a single facade render with no floor plan never states interior functions as verified.
- AC-15: 6 steps keep the same frame size and position, and the labels are present.
- A townhouse plan differs from a villa plan.
- The SVG is byte-identical across runs.

### 2. UI: `apps/desktop/src/features/diagram/`

The flow:

1. Select the source render.
2. Choose the diagram type.
3. Choose the step count (4, 6, 8 or custom).
4. Choose the layout (2×2, 2×3, 2×4 or linear).
5. Choose the language (vi or en).
6. Edit each step: its title, its caption and its evidence. Approve the step.
7. Preview the SVG sheet.
8. Export.

Isometric frames are optional. They are generated as one batch through the existing generate flow and the conflict gate, using the SRS §10.3 prompt and one fixed camera. Without frames, the sheet uses the source render with the vector overlay.

Register a `diagram` workspace module in `modules.ts` and enable it once the UI is complete. Keep the existing module order rules.

Strings: Vietnamese with full diacritics, plus English.

### 3. Export

- **PNG 2K/4K:** rasterize the SVG in the webview and save it as a new asset through the existing import path. Assets keep their lineage (`parentAssetId`).
- **MP4:** available only after every step is approved.
  - Add a Rust command `diagram_video_export` that takes frame image paths and timings, and runs FFmpeg from PATH (pan, zoom and appear).
  - If FFmpeg is missing, return a clear error, and the UI disables the button with "Chưa cài FFmpeg".
  - Never bundle FFmpeg.
  - Use the `blocking()` pattern.
  - Mirror the DTO in the contract fixtures.
  - The Rust test must not require FFmpeg. Skip the run when FFmpeg is absent, and test the argument building.

### 4. API contracts

Add a short new section to `docs/API_CONTRACTS.md`.

## Out of scope

Do not touch:

- `packages/domain/src/{detail,effects,sceneObjects,contextLibrary,publishing}/**`
- `features/{detail,effects,sceneObjects,enhance,publishing}/**`

## Done when

- `npm run verify` and `npx prettier --check .` pass.
- In `apps/desktop/src-tauri`, these pass:
  - `cargo fmt --check`
  - `cargo clippy --offline --all-targets -- -D warnings`
  - `cargo test --offline`
- `docs/agent-notes/srs-p4.md` is written.
- Do not commit. Do not touch `.env`. Make no paid calls in tests.
