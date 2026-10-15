# wt/grade-ui

- Agent: claude (scope items 2–7 of `docs/agent-tasks/grade-ui.md`; item 1, the V5.2/V5.3 merge, is commit 337d84e).
- Goal: grade v2 UI on top of ADR-031/032: gallery with style presets and LUTs, v2 slider groups with live engine preview, LUT library, batch for any grade.

## Done

- **Gallery** (`features/mood/GradeLookGallery.tsx`): categories All/Natural/Warm/Cool/Editorial/Cinematic/Special (30 v1 looks, TS thumbnails), **Hợp phong cách** (5 `GRADE_STYLE_PRESETS`, real 256 px `grade_preview` thumbnails, badge when `gradePresetsForStyle` matches the interior `styleId` or the exterior `building.architecturalStyle` key/words), **LUT** (the library, only when the parent passes `onLut`). Thumbnails load lazily (`features/luts/useLazyThumbnail.ts`: IntersectionObserver + per-request sequence, stale answers dropped, object URLs revoked, `<img onError>` → failed state).
- **Preset helpers** (`features/mood/gradePresets.ts`): `stylePresetGrade`, `chooseGradePreset` (a look replaces all adjustments but keeps the LUT layer), `withLut` (strength 70 on first select, kept on re-select), `withLutStrength`, `projectStyleKeys`, `matchingStylePresets`.
- **Grade panel v2** (`features/mood/GradeSliders.tsx`, `MoodGradePanel.tsx`): collapsible groups Ánh sáng / Màu / Hiệu ứng / Tách tông / Đường cong, min/max range labels, double-click reset, keys (arrows ±1, Shift+arrow and PageUp/Down ±10, Home/End). A manual edit clears `look`; resetting texture/vignette/grain to 0 or an all-zero split tone removes the field, so the grade drops back to the v1 path.
- **Live preview** (`GradeCanvas.tsx`, used by the centre view and the batch dialog): `isGradeV2(grade)` → `grade_preview` (640 px) debounced 120 ms, stale responses ignored, result scaled onto the original pixel grid; otherwise the TS v1 path. Before/After/Split (dirty-rectangle fix) work in both. The right-panel CSS preview is shown only for v1 grades (it cannot render LUTs/v2), with a hint otherwise.
- **Panel source fix**: the panel preview now uses the same image `applyGrade` grades (selected asset, else master). It used master-first before.
- **LUT library** (`features/luts/LutLibrary.tsx`, `lutApi.ts`): panel tab + full-size dialog (`LutLibraryDialog`, widened with `.dialog:has(.lut-library-full)`); add folder via `@tauri-apps/plugin-dialog` `open({ directory: true })` (browser preview: `window.prompt`), scan summary; pages of 60; grouped by pack › category per page; search; ★ favourites and "Hợp kiến trúc" (default on) filters; favourite toggle; hover enlarges the thumbnail; log badge; select → `lut { lutId, strength: 70 }` + strength slider + "Bỏ LUT"; source manager with rescan and remove behind `ConfirmDialog`; "Không tìm thấy file" for `status: missing` and for a `NOT_FOUND` preview.
- **Batch** (`BatchGradeDialog.tsx`, `batchGrade.ts`): choose a v1 look, a style preset or the current project grade (read only), plus an optional LUT layer from the gallery's LUT tab. `gradeAtIntensity` per ADR-032: all numeric fields incl. texture/vignette/grain scale linearly, `lut.strength` and split-tone saturations scale, tone curve, hues, balance, LUT id and `look` are kept, absent optional fields stay absent. Never writes `draftDna.colorGrade`; read-only/archived shows a notice and Run stays disabled. Stop/resume/retry and the single `asset_list` refresh are unchanged.
- **GradePreview exposure**: `exposureBrightness` maps −100..100 to ±1 stop (`2^(e/100/2.2)` as CSS brightness) instead of `1 + e/6`.
- **Bridge** (`lib/bridge.ts`): typed `lut_*` and `grade_preview` commands and schemas (`LutSourceSchema`, `LutItemSchema`, …); `binaryPreview()` shared by `assetPreview`, `gradePreview`, `lutPreview`.
- **New command `lut_source_list`** (Rust `luts::list_sources`, `commands.rs`, `lib.rs`, mock): the source manager needs the source paths after a restart and the API had no way to list them. Covered in the existing `indexes_nested_packs…` Rust test.
- Strings: `moodGrade.*` additions and a new `luts` section in vi (with diacritics) and en.
- CSS: inside the marked grade-ui block of `styles/app.css`.

## Open

- `docs/API_CONTRACTS.md` §21.2 does not list `lut_source_list { } → LutSource[]` yet (docs are outside this brief; please add).
- Mock `grade_preview`/`lut_preview` return a header-only JPEG that does not decode, so in the browser preview the v2 centre view shows the preview error and LUT tiles show "No preview". Real Tauri returns real JPEGs. A decodable tiny JPEG in the mock would make the browser preview nicer.
- Pre-existing, not from this branch: the ADR-029 mood preset cards (`.preview-card-image`, 640 px wide images inside 160 px cards) overflow the Mood/Grade right panel horizontally (panel-body scrollWidth 868 vs 364). Fix belongs to the previews CSS owner.
- Grouping is per page (backend orders by name), so a pack can appear on several pages.
- The Rust `lut_list` query matches the LUT name only; the mock also matches pack/category.
- Not exercised in a real Tauri window (browser preview with the mock backend only; the pane did not paint reliably, so IntersectionObserver was checked in tests).

## Tests

- `npm run verify` (typecheck, lint, 601 vitest, Rust 283 + 6 ignored) and `npx prettier --check .` green.
- `cargo fmt --check` and `cargo clippy --offline --all-targets -- -D warnings` in `apps/desktop/src-tauri` clean.
- New: `apps/desktop/tests/gradeUi.test.tsx` (24: style badge/presets, gallery categories incl. style and LUT, lazy IntersectionObserver loading, stale thumbnail, sliders groups/reset/keys, debounce into `grade_preview` and stale response ignored with Split/Before, v1 path untouched, LUT pagination/arch filter default/log badge/missing/strength, remove confirmation, add folder summary, batch stop/resume/retry and style-preset scaling, read-only, exposure scale, vi strings); `batchGrade.test.ts` +1 (v2/LUT intensity).

## Pitfalls

- jsdom has no `URL.createObjectURL` or `IntersectionObserver`; tests stub the first, and `useInView` treats a missing observer as visible.
- `react-hooks/set-state-in-effect` rejects synchronous setState in effects; the v2 "rendering" state is derived from the last settled request key instead.
- In the browser pane the page may stop painting (rAF and IntersectionObserver frozen) when the window is not drawn; clicks then seem to do nothing. Check with `requestAnimationFrame` before debugging the UI.
- The bash tool here broke on some long quoted heredocs; writing the patch script to a file first was reliable.
