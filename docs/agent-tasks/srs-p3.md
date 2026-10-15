# SRS P3 — Enhance preservation modes, local checks, upscale targets (ADR-035)

**Branch:** `wt/srs-p3`.

## Read first

- ADR-035, plus ADR-033 (QC removed) and ADR-034 in `docs/DECISIONS.md`
- `docs/specs/MASTER_SPEC_SRS_1_0.md` §8 and §9, AC-10 … AC-13
- Domain: `packages/domain/src/generation/{enhance,batch}.ts`, `packages/domain/src/schemas/generation.ts`
- UI: `apps/desktop/src/features/enhance/*`, `apps/desktop/src/features/regions/*`
- Rust:
  - `apps/desktop/src-tauri/src/providers/local_upscale.rs`
  - `services/generations.rs`, `services/batches.rs`
  - `services/regions/` (`mask.rs`)
  - `docs/API_CONTRACTS.md`, the enhance, region and batch sections

## Scope

1. **Domain**
   - Optional `preservationMode` and `locks` in `EnhanceParamsSchema`, plus the optional `upscale` target object, as specified in ADR-035.
   - Old params parse unchanged.
   - Regenerate the JSON schema with `npm run schema:export` if it changes.
   - `buildEnhancePrompt` uses the SRS §8.2 template when `preservationMode` is set. Without it, the output stays exactly the same as today; test this.
   - Size math as a pure helper, `resolveUpscaleSize(src, target, ifAlreadyLarger)`:
     - keeps aspect
     - long edge exactly 2048 or 4096
     - UHD contain gives a letterbox size and never crops
     - `custom` uses contain
     - never downscales unintentionally
2. **Rust**
   - `local_upscale` honours the new targets: Lanczos3 plus the existing unsharp, letterbox padding for UHD contain, and a PNG alpha channel is kept.
   - After an enhance job, composite the locked regions back from the source when `balanced` or `creative` mode has a region mask.
   - Compute `EnhanceCheck`:
     - size and aspect
     - registration offset on a downscaled luma
     - SSIM of locked pixels (implement a small SSIM, no new heavy crate)
     - in `strict` mode, an edge-structure delta
   - Store the check as JSON on the generation. Add a migration with a new optional column if needed, and never touch the old QC tables.
   - Expose the check in `GenerationDto` as an optional field. Add a short bullet to `API_CONTRACTS`.
   - Unit tests on synthetic images:
     - an identical image passes
     - a shifted image warns
     - a changed locked region warns
     - aspect is kept for 3:2 → 4096 (AC-12)
     - alpha is preserved
     - an image already larger than the target follows `ifAlreadyLarger`
3. **UI**
   - `EnhancePanel` gets a mode selector: "Giữ nguyên chi tiết" (strict), "Nâng cấp thông minh" (balanced), "Nâng cấp mạnh" (creative).
   - Lock checkboxes.
   - The size target selector: 2K, 4K, UHD (contain), Custom, plus the if-larger choice.
   - Strict mode never calls a paid provider.
   - The result shows the `EnhanceCheck` badge ("Đạt kiểm tra" or "Cần xem lại") with its reasons.
   - `EnhanceBatchDialog`:
     - shows the estimated cost, or "Chưa xác định chi phí", and asks for confirmation before a paid submit when the cost is known
     - keeps per-item status, retry of failed items only, and skip
     - fix the existing mojibake in the batch name (`Â·` → `·`)
   - Use the existing conflict gate (`features/validation/gate.ts`) for any generative submit, as today.
   - i18n in vi with full diacritics and in en.
4. **Tests**
   - The domain size math.
   - The prompt with and without the mode.
   - A store or UI test that strict mode calls only `local_upscale`.
   - AC-13 batch: 20 items with 2 failures keeps the 18 successes and retries exactly the 2 failures.
   - The Rust tests listed above.

## Out of scope

- ComfyUI or remote providers.
- LPIPS.
- Vision QC.
- Do not touch `packages/domain/src/{site,spaceCatalog,prompt/sections}/**`, `features/site/**` or `features/space/**`; another branch owns them.

## Done when

- `npm run verify` and `npx prettier --check .` pass.
- In `apps/desktop/src-tauri`, these pass:
  - `cargo fmt --check`
  - `cargo clippy --offline --all-targets -- -D warnings`
  - `cargo test --offline`
- `docs/agent-notes/srs-p3.md` is written.
- Do not commit. Never touch `.env`. Make no paid API calls in tests.
