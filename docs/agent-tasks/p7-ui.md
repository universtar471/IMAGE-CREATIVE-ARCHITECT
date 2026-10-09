# P7-C — UI: Hậu kỳ › Chỉnh vùng module, canvas region tools, scene objects, selective edit

Branch `wt/p7-ui`. You own `apps/desktop/src/**` and `apps/desktop/tests/**`, except `tests/fixtures/backend`.

## Read first

- `tasks/PHASE_07.md`, ADR-025, API §16, ADR-022..024
- `features/workspace/modules.ts`: add a new module id `regions` in the Hậu kỳ group, after QC
- guided-workflow components (StepFrame, banners, gating)
- `features/enhance/` and `features/qc/` as patterns: panel, cost text, CompareCanvas, overlay mapping, stale-response guards
- `components/canvas/`, `i18n/`, `lib/bridge.ts`, `lib/mockBackend.ts`, `app/store.ts`

## Domain stand-ins

The domain helpers are built in parallel:
- schemas
- `rasterizeMask`, `featherMask`
- `buildRegionEditPrompt`
- the `"region_edit"` purpose
- scene helpers

Until they land, add stand-ins in `apps/desktop/src/lib/regions.ts` with exactly the §16 shapes, marked `TODO(p7-domain)`.

## Scope

1. **Module.** Add "Chỉnh vùng" / "Region edit":
   - gated on an approved master, using the same banner pattern
   - a "Cách dùng" box (vi/en): draw a region, label it or link an object, pick edit or material replace, run; outside the region stays untouched; AI costs credits
2. **Canvas tools** for the selected image:
   - **Rectangle:** drag.
   - **Polygon:** click points; double-click or Enter closes; Esc cancels.
   - **Brush:** size slider; drag to paint strokes.
   - **Select / move:** click a region to select; Delete removes it.
   - **Auto-select:** a disabled button with the tooltip "Phase sau — cần mô hình phân vùng".
   - Coordinates are normalised to the displayed image rect, reusing the QC overlay mapping.
   - Regions are drawn with labels.
   - A mask preview toggle draws `rasterizeMask` as a translucent overlay.
   - Save through `region_save` with a debounce, using the stale guards.
3. **Region list.** Show:
   - label (editable)
   - kind select
   - linked scene object select
   - delete
   - multi-select checkboxes for editing
4. **Scene objects section** (project-level DNA `scene`, autosaved through the DNA path):
   - add/remove objects with name, category, material and relations (type + target)
   - a pin toggle per object, writing `locks.objectIds`
   - pinned objects show in the prompt preview
5. **Edit panel**
   - **Mode:** "Chỉnh sửa tự do" with an instruction textarea, or "Đổi vật liệu" with a material field. Suggestions come from the DNA materials plus free text.
   - **Provider/model:** limited to models with references.
   - **Mask badge:** "Mask gốc" when `supportsMask` is true; "Mask qua ảnh phụ + ghép cục bộ" when false.
   - **Cost text:** never shows "free" for AI.
   - **Prompt preview:** shows `buildRegionEditPrompt`.
   - **Submit:** `generation_submit` with purpose `region_edit`.
   - **Result:** open CompareCanvas with the source and the result.
6. **Versions panel.** Label `region_edit` with a summary, e.g. "Chỉnh vùng · 2 vùng · đổi vật liệu: đá ong".
7. **Mock backend**
   - region commands
   - the `region_edit` purpose with a canvas composite that uses the same rasterise/feather helpers, so pixels outside the mask equal the source
   - `supportsMask` on the mock providers
8. **Tests**
   - gating
   - each drawing tool produces correct normalised shapes (rect, polygon close/cancel, brush)
   - select/delete
   - save debounce with the stale guard
   - mask preview uses `rasterizeMask`
   - scene objects and pins reach the DNA
   - edit payloads for both modes and both mask kinds
   - versions label
   - i18n parity and the mojibake/diacritics guard

## Done when

- `npm run verify` is green and prettier is clean.
- `docs/agent-notes/p7-ui.md` is written and lists the stand-ins.
