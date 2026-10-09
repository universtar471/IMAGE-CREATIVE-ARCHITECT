# P5-C — UI: Hậu kỳ › Nâng cấp module, compare view, batch enhance (ADR-023, API §14)

Branch `wt/p5-ui`. You own `apps/desktop/src/**` and `apps/desktop/tests/**` except `tests/fixtures/backend`.

## Read first

- `tasks/PHASE_05.md`, ADR-023, API §14, ADR-022 / §13
- `features/workspace/modules.ts` (the `enhance` module, currently future)
- the guided workflow components (step frame, banners, gating)
- `features/mood/` (GradeCanvas compare, MoodGradePanel)
- `features/generate/` (provider/model/params/cost controls)
- `features/camera/BatchDialog.tsx`, ContactSheet, `i18n/`, `lib/bridge.ts`, `lib/mockBackend.ts`, `app/store.ts`

## Domain stand-ins

The domain helpers are built in parallel in `packages/domain`:
- `EnhanceParams` schema
- `buildEnhancePrompt`, `buildEnhanceItems`
- the `"enhance"` purpose
- `ENHANCE_TARGETS`

If you need one before it lands, add a stand-in in `apps/desktop/src/lib/enhance.ts` with exactly the §14 shapes, marked `TODO(p5-domain)`.

## Scope

1. **Module**
   - Enable `enhance` (Hậu kỳ › Nâng cấp).
   - Gate it on an approved master, with the same banner pattern as Mood / Chỉnh màu.
   - Add a "Cách dùng" box with 2–4 lines in vi and en, explaining:
     - conservative = free, local, sharper and larger, no change
     - generative = adds real detail through AI, costs credits
     - Architecture Preserve
2. **Panel**
   - **Source:** the selected image, with its current size shown.
   - **Mode:** segmented control, Giữ nguyên chi tiết (conservative) / Thêm chi tiết AI (generative).
   - **Target long edge:**
     - 2048 / 3072 / 4096, plus "Giữ kích thước" for generative.
     - Disable targets smaller than the source, with a tooltip.
   - **Detail strength:** slider 0–100, default 40, with the low/medium/high label.
   - **Architecture Preserve:** toggle, default on.
     - Turning it off shows a warning line.
   - **Provider/model:** only for generative.
     - Reuse the Generate panel controls, filtered to models with references.
     - Show the HHTECH cost hint for the chosen tier.
   - **Prompt preview:** collapsible, showing the enhance prompt.
   - **Submit:**
     - "Nâng cấp" calls `generation_submit` with purpose `enhance`.
     - The job shows in the Jobs tray.
     - When it is done, select the result and open the compare view.
3. **Compare view**
   - A reusable `CompareCanvas` with before / after / split slider for two assets (source vs result).
   - Load pixels with `assetPreview` (Blob from binary IPC, never `fileUrl` into a canvas; see the p4-preview-fix note).
   - Use it for enhance results; refactor the grade preview to share the split UI where cheap.
4. **Batch enhance**
   - From the Contact Sheet or the asset tray multi-select: "Nâng cấp hàng loạt".
   - Opens a dialog with the same params.
   - Calls `batch_create` with `buildEnhanceItems`.
   - Shows the total cost hint.
5. **Versions panel**
   - Show `operation = "enhance"` with its params summary, e.g. "Nâng cấp ×2 · 4096px · AI chi tiết 40".
6. **Mock backend**
   - Implement `local_upscale` (canvas resize) and the enhance purpose.
   - Exact resize; new asset + version.
7. **Tests**
   - module gating
   - panel validation (targets disabled below the source)
   - submit payload for both modes
   - batch dialog items
   - compare view loads via `assetPreview` (once per asset)
   - versions label
   - i18n parity

## Done when

- `npm run verify` is green and prettier is clean.
- Checked in the browser preview if available.
- `docs/agent-notes/p5-ui.md` is written, listing the stand-ins to swap.
