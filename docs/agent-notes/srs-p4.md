# wt/srs-p4 — Diagram Studio MVP (ADR-037)

## Goal

SRS §10, AC-14 and AC-15: plan diagram steps from DNA facts, lay out a deterministic vector SVG sheet, run the UI flow, export PNG 2K/4K and MP4 (FFmpeg on PATH), and generate optional isometric frames through the existing batch flow and conflict gate.

## Done

- **Domain** (`packages/domain/src/diagram/`). The partial Codex draft was reviewed and rewritten:
  - It appended the illustrative label into the title text. The badge now comes from `evidence`, so editing a title cannot remove the label.
  - It repeated candidates when the count was larger than the list.
  - Its annotation positions went out of the 0..1 range above 9 steps.
  - It had no interior-evidence model.
- **`schemas.ts`**:
  - Steps gain `interior`, `basis` and `approved`.
  - Adds `DiagramPlan { version, type, family, interiorVerifiable, steps }` and the `sources` option.
  - Adds DTOs for `diagram_image_save`, `diagram_ffmpeg_status` and `diagram_video_export`.
- **`planner.ts`**:
  - Eight candidates per type and family: townhouse, villa or generic.
  - Concept, massing and circulation sequences differ between townhouse and villa.
  - Evidence rule: `verified` only when the facts in `basis` exist. Interior steps need confirmed space-catalog facts (AC-14); a floor-plan source makes them `inferred`. Airflow, escape routes and sun orientation are never verified.
  - Count handling:
    - Counts below 8 are subsampled evenly, keeping the first and last step.
    - Counts above 8 insert illustrative "development" steps.
    - Counts must be 2–12.
  - Helpers: `editDiagramStep` (refuses a forbidden evidence and clears the approval), `approveDiagramStep`, `setDiagramStepFrame`, `allowedDiagramEvidence`.
- **`layout.ts`**:
  - Fixed panel geometry: 320×292 panel with a 320×180 frame.
  - Fixed palette and fonts; coordinates rounded to one decimal; XML escaping.
  - Header, legend and evidence badges.
  - Uses the source render, an attached frame or a vector placeholder block.
  - `layoutDiagramFrame` builds the 1600×900 video frames.
- **`frames.ts`**:
  - SRS §10.3 prompt verbatim and a fixed isometric camera.
  - `buildDiagramFrameItems` builds one batch item per step, with `metadata.diagram.stepId`.
  - `diagramFrameOutputs` maps the newest frame batch back to steps by step id.
- **`video.ts`**: `diagramVideoTimeline` refuses unapproved plans. Motions are appear first, then zoom and pan alternating.
- **Rust** (`services/diagram.rs`):
  - `diagram_image_save`: base64 PNG → `store_managed_image` → an asset with `parent_asset_id` and operation `diagram_sheet` or `diagram_frame`, plus a version row. This is the same verified managed write that import and grade use.
  - `diagram_ffmpeg_status`: runs `ffmpeg -version`.
  - `diagram_video_export`:
    - Frames must be managed files of the project; `..` paths are refused.
    - Width and height must be even; frame and fps ranges are checked.
    - Filter chain per frame: scale ×2, pad, then `zoompan` and/or `fade`; the frames are joined with `concat`. Output is libx264 yuv420p, written to `exports/`.
    - Missing FFmpeg → `INVALID_STATE` with `details.reason = "ffmpeg_missing"`. A failed run → `IO_ERROR` with `reason = "ffmpeg_failed"` and the stderr tail.
  - All three commands use the `blocking()` pattern and `CREATE_NO_WINDOW` on Windows.
  - Fixtures, recorded last so the existing fixture ids are unchanged: `diagram_image_save`, `diagram_ffmpeg_status`, `error_diagram_ffmpeg_missing`.
- **UI** (`apps/desktop/src/features/diagram/`):
  - The `diagram` module sits after Region edit, in the `post` group, and is enabled.
  - `DiagramPanel` steps:
    1. source
    2. extra sources
    3. type
    4. 4/6/8/custom count
    5. layout
    6. language
    7. plan
    8. per-step vi/en title and caption, evidence (forbidden options disabled) and approve
  - Frames section: provider and model, spend confirm, then `createBatch` with purpose `variation` (the conflict gate runs in the store), then "use the frames".
  - Export section: PNG 2K/4K and MP4. All exports need every step approved. MP4 is disabled with "Chưa cài FFmpeg" when FFmpeg is missing.
  - `DiagramCanvas` previews the same SVG as an `<img>` data URL.
  - `raster.ts`:
    - Images are embedded as data URLs taken from `asset_preview`.
    - The SVG root is resized to the target pixels before drawing to the canvas, so the vectors stay sharp.
  - The mock backend implements all three commands. `MockOptions.ffmpeg` turns FFmpeg on; it is off by default.
- **Docs**: §22 in `docs/API_CONTRACTS.md`. i18n vi (full diacritics) and en.

## Tests

- `npm run verify`: 78 files, 936 vitest tests, plus 314 Rust tests (6 ignored), all green.
- `cargo fmt --check`, `cargo clippy --offline --all-targets -D warnings` and `prettier --check .` pass.
- New tests:
  - `packages/domain/tests/diagram.test.ts` (17 tests): AC-14, AC-15, townhouse vs villa, byte-identical SVG, counts, escaping, frames, timeline.
  - `apps/desktop/tests/diagram.test.tsx` (7 tests).
  - 6 Rust tests in `services::diagram`. The real MP4 test runs only when FFmpeg is on PATH and otherwise prints "skipped". It ran here with FFmpeg 8.1.1.
- Commands (in every shell): `export CARGO_TARGET_DIR=F:/cargo-targets/srs-p4`, then `npm run verify`, and in `apps/desktop/src-tauri` run `cargo test --offline`.

## Still open / limitations

- **No persistence.** The diagram plan, edits and approvals live only in the session store, per open project. There is no migration or table, so they are lost on restart. A table (migration 0010) would be next.
- **Not seen rendered yet.** PNG rasterization (SVG → canvas) and MP4 export were not exercised in the real Tauri webview; jsdom cannot rasterize. The Rust FFmpeg path was tested for real. Someone should click PNG 4K and MP4 in the app once and check that text is sharp and diacritics render (Segoe UI or Arial).
- **Extra assets per video.** Each MP4 export saves one `diagram_frame` asset per step; these are the frame paths FFmpeg needs. The MP4 itself is not an asset; its path is shown in a toast.
- **Approximate text layout.** Wrapping and badge widths are estimated from character counts, not measured, so very long words may overflow slightly.
- **Naive verification rule.** Interior "verified" accepts any confirmed space fact, not one that matches the specific zone.
- **Frames untested end to end.** The frame batch uses the compiled DNA bundle with the positive prompt replaced. Its output quality and consistency with a real paid provider are untested; no paid calls were made.
- **Flaky existing test.** `tests/regions.test.ts` ("stores native-mask…") waits a fixed 20 ms and failed once under load. It is unrelated and passes on rerun.

## Pitfalls

- Python on Windows writes CRLF unless `newline=''` is passed. Check `git ls-files --eol` after scripted edits.
- Adding fixture records before the end of `build_fixtures` renumbers the ids in every other fixture.
