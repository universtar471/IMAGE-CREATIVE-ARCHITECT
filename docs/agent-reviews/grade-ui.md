# Review: colour grade UI — V5.2/V5.3 merge, grade v2 panel, LUT library, batch (ADR-031, ADR-032)

Branch: `wt/grade-ui`.
Verdict: **ĐẠT** (pass).

## Verification (run by the lead, after merging main)

- `npm run verify` passes:
  - typecheck and lint
  - 575 JS tests
  - the Rust suite
- `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` are clean.
- `npx prettier --check .` is clean.

## Checked

**The user's V5.2/V5.3 patch**
- It is kept as a raw import commit (68bfab0), so the original code stays reviewable.
- It had never been compiled. About ten bugs were fixed in 337d84e:
  - double-click double run
  - a saved image counted as failed
  - stop, close and unmount during a run
  - a false "completed" message
  - about 40 hard-coded strings
  - a prototype-key look check
  - stale gallery thumbnails

**Gallery**
- 30 v1 looks with TypeScript thumbnails.
- "Hợp phong cách": the five v2 presets with `grade_preview` thumbnails and the style badge.
- A LUT group.
- Thumbnails load lazily and stale responses are dropped.

**Panel**
- v2 slider groups.
- v2 and LUT grades preview through the debounced `grade_preview`; v1 keeps the TypeScript path.
- Preview and Apply now use the same source image. Before, the preview showed the master while Apply graded the selected image.

**LUT library**
- Every item in API §21.3 is covered.
- The new `lut_source_list` (documented in API §21.2) lets sources survive a restart.

**Batch**
- Accepts v1 looks, style presets, or the project grade plus a LUT.
- Intensity scales per ADR-032.
- Never writes `draftDna.colorGrade`; disabled for read-only projects.

## NÊN SỬA (should fix, not blocking)

1. The mock `grade_preview` and `lut_preview` return bytes that are not a valid JPEG, so the browser preview with the mock backend shows preview errors. Return a real tiny JPEG.
2. Mood preset cards (`.preview-card-image`, a 640 px image in a 160 px card) make the right panel scroll horizontally. This predates the branch.
3. LUT pack and category grouping is computed per page, so one pack can appear on two pages.
4. Not yet exercised in the real Tauri window. The user should test: add a LUT folder, choose a style preset, run a small batch.
