# P6-C — UI: Hậu kỳ › QC module, overlays, badges, repair, settings

Branch `wt/p6-ui`. You own `apps/desktop/src/**` and `apps/desktop/tests/**` except `tests/fixtures/backend`.

Read first:
- `tasks/PHASE_06.md`, ADR-024, API §15, ADR-022/023
- `features/workspace/modules.ts` (`qc` is currently future)
- the guided-workflow components (StepFrame, banners, gating)
- `features/enhance/` (as a pattern: panel, cost hint, batch dialog, CompareCanvas, `assetPreview`)
- `components/canvas/`, ContactSheet, the BottomTray asset grid, `i18n/`, `lib/bridge.ts`, `lib/mockBackend.ts`, `app/store.ts`

## Domain stand-ins

The domain helpers are being built in parallel: schemas, `scoreReport`, `parseVisionReply`, `buildVisionPrompt`, `buildRepairPrompt`, the `"repair"` purpose and `QC_CATEGORIES`. Until they land:
- Write stand-ins in `apps/desktop/src/lib/qc.ts` with exactly the §15 shapes.
- Mark each one `TODO(p6-domain)`.

## Scope

1. **Module**
   - Enable `qc` (Hậu kỳ › QC), gated on an approved master with the same banner pattern.
   - Add a "Cách dùng" box (vi/en): local check is free; AI vision costs credits; how to read the scores; "Sửa theo QC".
2. **Panel** for the selected image:
   - A run button with a choice of "Chỉ kiểm tra cục bộ (miễn phí)" or "Kiểm tra bằng AI".
     - The AI option uses a provider/model select limited to providers with `capabilities.vision`.
     - Cost text: "chưa có ước tính giá" unless a price is known.
   - The latest report:
     - a result badge (pass / warn / fail / unscored, colour-coded, vi/en labels)
     - `overall`
     - five category bars
     - the local metrics, with `edgeAlignment` "không áp dụng" when null
     - lists of issues and artifacts
     - `repairInstruction`
   - A report history list from `qc_list`.
   - "Sửa theo QC": enabled for warn/fail reports that have vision.
     - It submits a `repair` generation using the domain `buildRepairPrompt`, the same provider/model as the source generation when available (otherwise the current Generate defaults), the two references, and `params.repair`.
     - Show the cost hint.
     - When it finishes, offer to compare the result with the source using CompareCanvas.
3. **Overlay**
   - A canvas toggle "Hiện lỗi" draws artifact boxes. Normalised coordinates map to the displayed image rect.
   - Box colour comes from severity, and each box carries a label.
   - It follows the selected asset and its latest report.
4. **Badges**
   - Small pass / warn / fail dots on tray and Contact Sheet items, from the latest report per asset.
   - Load lazily per project and refresh after runs.
5. **Settings section** (collapsible):
   - `passMin`, `categoryMin`, `highArtifactFails`
   - `autoQc` and `autoRepairMax`, with a clear cost warning
   - the vision provider/model
   - Save with `qc_settings_set`.
6. **Batch QC**
   - From a multi-selection: "Kiểm tra QC hàng loạt".
   - Runs sequentially and shows progress. Results update the badges.
7. **Mock backend**
   - Implement the four commands.
   - Local metrics: a cheap deterministic approximation is fine in the mock, but keep the result rules exactly per `scoreReport`.
   - A deterministic fake vision reply.
   - The `repair` purpose.
   - Settings persistence.
8. **Tests**
   - gating
   - run local / vision payloads
   - report rendering incl. `unscored` and the null `edgeAlignment` text
   - overlay box mapping
   - badges
   - repair submit payload
   - settings round trip
   - batch progress
   - i18n parity and the no-mojibake guard

## Done when

- `npm run verify` is green and prettier is clean.
- `docs/agent-notes/p6-ui.md` is written, listing the stand-ins to swap.
