# WF-C — UI: guided workflow, navigation, Overview hub, guides, read-only steps

Branch `wt/wf-ui`. You own `apps/desktop/src/**` and `apps/desktop/tests/**` except `tests/fixtures/backend`.

Read first:
- `tasks/PHASE_04B.md`, ADR-022, API §13
- `features/workspace/modules.ts`, `ProjectWorkspace.tsx`
- every feature panel (`dna/`, `camera/`, `lighting/`, `mood/`, `generate/`, `overview/`)
- `i18n/`, `lib/bridge.ts`, `lib/mockBackend.ts`, `app/store.ts`

## Domain stand-ins

The workflow domain helpers are being built in parallel in `packages/domain`:
- `deriveWorkflow`, `confirmStep`, `reopenStep`, `isGenerationAllowed`
- `WORKFLOW_STEPS` and the schemas

Until they land, write a stand-in in `apps/desktop/src/lib/workflow.ts`:
- Use exactly the API §13 signatures and rules.
- Mark it `TODO(wf-domain)`; integration will swap it.

## Scope

1. **Navigation.** Left nav, in this order:
   - Tổng quan
   - DNA thiết kế, a group with 5 numbered sub-items:
     1. Kiến trúc (`design_dna`)
     2. Bối cảnh
     3. Tham chiếu
     4. Góc máy
     5. Ánh sáng
   - Tạo ảnh (`generate`)
   - Hậu kỳ, a group: Mood / Chỉnh màu, then Enhance and QC as future items
   - Xuất (export, future)

   Each step item shows a status icon with a tooltip: locked 🔒, available, confirmed ✓, needs_review ⚠, done ✓, skipped –.

2. **Store.**
   - On project open, load the workflow with `workflow_get`.
   - Derive it with `deriveWorkflow`. Facts:
     - `project.masterApproved` / status
     - DNA anchor-view cameras
     - `camera_anchor_list`
   - Refresh after:
     - confirm or reopen
     - master approval
     - anchor set or clear
     - DNA camera changes
   - Guard against project switches like the other store actions.

3. **Step frame.** A wrapper component used by the five DNA panels:
   - **Header:** "Bước N/5 — <name>" plus a status chip.
   - **"Cách dùng" box:** collapsible, 2–4 short lines on what to do here and what "done" means. Write good, concrete Vietnamese and English for every step.
   - **Footer button:**
     - "Xác nhận & khoá bước" when the step is available.
     - "Mở khoá để sửa" when confirmed or needs_review. Reopening shows a confirm dialog listing the later steps that will need review.
   - **Read-only when locked or confirmed:** every input disabled. Use `fieldset disabled` or a context flag that the field components read.
   - **Banners:**
     - Locked: "Hoàn thành bước '<X>' trước", with a button that navigates there.
     - needs_review: amber, "Bước trước đã thay đổi — kiểm tra lại rồi xác nhận".

4. **Field hints.** A short hint (help icon or subtitle) on every field, in the vi and en dictionaries:
   - Camera: azimuth, elevation, height, distance, lens (with a mm guide), aspect, composition.
   - Lighting/weather: time of day, sun direction/elevation, shadows, ambient, sky, humidity, wetness, haze.
   - Artificial lights: zone, and a colour temperature guide (2700 warm / 4000 neutral / 6500 cool).

5. **Camera split.**
   - DNA › Góc máy keeps the camera list, editor, diagram, presets and the "Anchor view" flag.
   - The "Anchor & sản xuất" actions (Generate anchors, Render cameras) and the Contact Sheet move into Tạo ảnh.

6. **Tạo ảnh** becomes a stepper. Each step is gated by `deriveWorkflow` / `isGenerationAllowed`, with the same banner pattern.
   1. **Ảnh Master:** the existing hero generate + approve master. Show "Đã có Master" when it was already approved from References.
   2. **Anchor:** generate anchors and approve them on the Contact Sheet. Show "Bỏ qua — không có góc Anchor" when skipped.
   3. **Render các góc máy.**

   Free variations (purpose `variation`) are available after Master. Keep the provider/model/params/cost controls.

7. **Hậu kỳ.**
   - Mood / Chỉnh màu is gated on `post.grade`.
   - "Dùng mood này" shows a confirm dialog when `dna.lighting` is confirmed: "Thao tác này cập nhật Ánh sáng/Thời tiết đã xác nhận". The step stays confirmed.

8. **Tổng quan (hub).** One card per stage. Inside, one row per step with:
   - its status
   - a one-line summary of its values, e.g. "Giờ xanh · 2 đèn · Mưa nhẹ", "3 góc, 1 Anchor", "Master đã duyệt"
   - buttons: Mở (navigate), and Xác nhận & khoá / Mở khoá

   Expanding a row shows 2–3 key fields of that step. Reuse the same field components; fields are editable only when the step is available.

   Keep the existing readiness and prompt preview sections.

9. **Rename the prompt lock.**
   - `LockToggle` label becomes "Ghim" (vi) / "Pin" (en).
   - Tooltip: "Giữ nguyên phần này khi áp preset hoặc tạo biến thể".
   - The workflow uses "Khoá bước". Never label both of them just "Khoá".

10. **Mock backend.**
    - Implement the three workflow commands, persisted in its in-memory DB.
    - Implement the §13.4 gating in generation and batch, using the same helpers.

11. **Tests.**
    - nav order and status icons
    - locked panel inputs disabled; the banner jump works
    - confirm unlocks the next step
    - reopen: the cascade dialog and `needs_review`
    - Generate stepper gating
    - Overview summary, quick edit and buttons
    - Ghim rename
    - i18n key parity

## Done when

- `npm run verify` is green and prettier is clean.
- Checked in the browser preview (mock backend, port 1421) in vi and en, if browser tools are available.
- `docs/agent-notes/wf-ui.md` is written and lists the stand-ins to swap.
