# SRS P3 handoff — enhance preservation modes, local checks, upscale targets (ADR-035)

Branch `wt/srs-p3`. Started by Codex (commit "SRS P3 (work in progress ...)", stopped by the
provider credit limit), finished and verified by Claude. Nothing is committed by Claude.

## Done

- **Domain** (`packages/domain/src/schemas/generation.ts`, `generation/enhance.ts`)
  - `EnhanceParams` gains optional `preservationMode`, `locks` (each default `true`),
    `allowedRegionIds` and `upscale { target, ifAlreadyLarger }`. Old params parse unchanged.
  - One shared purpose contract, `enhanceContractIssues`, used by both
    `GenerationSubmitRequestSchema` and `BatchCreateRequestSchema`: strict ⇒ conservative +
    `local_upscale` + no allowed region; balanced/creative ⇒ generative; conservative may omit
    `targetLongEdge` when `upscale` is set.
  - `resolveUpscaleSize(src, target, ifAlreadyLarger)`: integer math only (round-half-up
    `roundDiv`), shared with Rust through `packages/domain/test-vectors/upscale.json`.
  - `buildEnhancePrompt`: with a mode, the SRS §8.2 template verbatim + editable-region line +
    intensity line + one line per active lock (+ materials under the material lock). Without a
    mode the output is byte-identical to main (asserted against the literal string).
  - `planEnhanceSources` / `buildEnhanceItems` drop sources that the target says to `skip`.
  - `failedBatchJobIds(jobs, batchId)`: failed + interrupted only (AC-13).
  - `EnhanceCheckSchema` (+ reasons enum). The DNA JSON schema is unaffected (no export needed).
- **Rust**
  - New `src/enhance.rs` (pure image math): `resolve_upscale_size`, `expected_layout`,
    letterbox (`place_on_canvas`, transparent fill for alpha sources, opaque black otherwise),
    `composite_locked` (inward-only feather, so every locked pixel equals the resized source),
    `compute_check` and `finish_output`.
  - `providers/mod.rs`: `UpscaleTarget` is `#[serde(untagged)]` (named string | custom object),
    `allowed_region_ids` added.
  - `local_upscale`: honours `upscale` (Lanczos3 + existing unsharp; keep = source pixels;
    quality_only = sharpen at source size; skip = error), letterbox for contain, alpha kept.
  - `services/generations.rs`: validation for modes / targets / custom sizes / skip / allowed
    regions; HHTECH tier from the resolved long edge; allowed regions loaded at run time; new P3
    output path (layout → composite → letterbox → check) only when `preservationMode` or
    `upscale` is set, the legacy resize path is untouched; check stored on the generation and
    provenance (`parentAssetId`, `inputHash`, `configHash`, `preservationMode`,
    `enhanceCheckId`, `enhanceCheckStatus`) in the asset `operation_json`.
  - Migration `0008_enhance_check.sql`: `generations.enhance_check_json TEXT` (nullable). QC
    tables untouched. `GenerationDto.enhance_check` is skipped when `None` (absent, not null).
  - Contract fixture `enhance_p3_generation_get.json` (Rust output parsed by the Zod schema);
    `ECK_` ids are normalized.
- **UI** (`features/enhance/*`, `ProjectWorkspace.tsx`)
  - `EnhanceControls.tsx`: `PreservationModeSelector` ("Giữ nguyên chi tiết" / "Nâng cấp thông
    minh" / "Nâng cấp mạnh"), `LockToggles` (disabled + all on in strict),
    `SizeTargetSelector` (2K / 4K / UHD contain / Custom w×h + "Nếu ảnh nguồn đã lớn hơn" keep /
    quality only / skip, with the resolved output size), `AllowedRegionPicker` (balanced /
    creative; regions of the source, kept per asset), `EnhanceCheckBadge` ("Đạt kiểm tra" /
    "Cần xem lại" + reasons + SSIM / shift).
  - Strict never offers or calls a paid provider: the provider list is local only, the submit
    is disabled for any other provider and `buildEnhanceRequest` / `buildEnhanceItems` throw.
  - The badge sits over the before/after comparison (`.enhance-check-overlay`).
  - `EnhanceBatchDialog`: same controls (no allowed regions in a batch), per-source output size
    and "Bỏ qua" for skipped sources, cost line with "Chưa xác định chi phí", spend
    confirmation before any paid submit (price shown when known), then a progress view with
    per-item job status, "Bỏ qua" for waiting items (job cancel) and "Thử lại {count} ảnh lỗi"
    that resends only failed/interrupted items (`retryFailedItems`). Mojibake fixed (`·`, `×`).
  - Mock backend: P3 validation, `resolveUpscaleSize` output sizes and a stand-in check.
  - i18n vi (full diacritics; the English leftovers of the enhance section were translated) + en.

## Codex bugs fixed

- `UpscaleTarget` custom variant was externally tagged in Rust (`{"custom":{...}}`), so the
  TS shape `{width,height,fit}` could not deserialize.
- `resolveUpscaleSize` reported `letterbox: true` and the UHD canvas for a source that is
  kept at its own size; float rounding instead of integer math; no offsets.
- Rust `resize_to_target` ignored `skip` (returned a copy) and let a legacy `targetLongEdge`
  resize run after the new path; `targetLongEdge` was still required with an upscale target in
  the provider, the Rust validator and both Zod contracts (UHD/custom could not be submitted).
- The "never downsizes" check rejected every larger source even with `ifAlreadyLarger`.
- No check computation, no persistence, no composite, no provenance (DTO was always `None`).
- The batch/panel mode switch could leave a generative provider selected for strict; strict
  items still built a prompt.
- Duplicated contract checks in generation.ts / jobs.ts (now one helper).

## Shapes chosen

- Check JSON is camelCase, see `EnhanceCheckSchema`; `version: "ec-1.0.0"`.
- Thresholds (`src/enhance.rs`): locked SSIM ≥ 0.98 (8×8 windows, stride 4, on a 256-px luma
  grid, only windows that are fully locked); registration on a 128-px luma grid, search ±12,
  warn above 1 grid px, a shift is only reported when it halves the error of no shift (so a
  locally edited region is not read as a global shift); aspect delta > 1 %; strict edge delta
  (Sobel, output threshold 80, source 40, 1-px tolerance) > 5 % and at least 0.2 % of pixels.
- Registration in balanced/creative uses the provider output before the composite.
- The comparison reference is the source resized to the content size with Lanczos3.

## Debts / limitations

- The allowed-region mask is not sent to the provider for enhance (only composited after).
- Balanced/creative batches cannot carry allowed regions (they are per asset): every item is
  "whole frame + review".
- Thresholds are tuned on synthetic images only; real renders may need adjustment.
- The SSIM / edge checks run at 256 px, so very fine changes can be missed (stated in the UI).
- Migration number 0008 may collide with another branch that adds a migration — renumber at merge.
- Batch progress lives in the dialog; closing it falls back to the contact sheet's per-item
  retry (which already existed).
- No `UpscaleProviderCapabilities` type yet (only the cost-unknown behaviour of ADR-035).

## Tests

- `npm run verify` (with `CARGO_TARGET_DIR=F:/cargo-targets/srs-p3`) and `npx prettier --check .`.
- In `apps/desktop/src-tauri`: `cargo fmt --check`, `cargo clippy --offline --all-targets -- -D warnings`,
  `cargo test --offline`.
- New: `packages/domain/tests/srs-p3-enhance.test.ts`, `apps/desktop/tests/enhanceP3.test.tsx`,
  Rust `enhance::tests`, new `local_upscale` and `generations` tests.

## Traps

- Disk D is nearly full: use `CARGO_TARGET_DIR=F:/cargo-targets/srs-p3`; the in-tree
  `src-tauri/target` (7 GB) was deleted.
- Regenerate backend fixtures with `UPDATE_BACKEND_FIXTURES=1 cargo test --offline contract_fixtures`.
- In `local_upscale.rs` the local variable `enhance` shadows the module: the module is
  imported as `sizing`.
- Tests run in English by default; assert Vietnamese text through the `vi` dictionary.
