# UX feedback round 2 — workflow, next step, image strip, region panel (ADR-029)

**Branch:** `wt/ux-fix-2`.

**You own:**
- `packages/domain/src/workflow/**`
- `packages/domain/src/prompt/**`
- `packages/domain/tests/**`
- `apps/desktop/src/**`
- `apps/desktop/tests/**`

Exceptions: do not touch `features/lighting`, `features/mood`, `features/dna/ContextDnaPanel.tsx`, `features/dna/*Preview*` or `features/previews/**`. Those belong to `wt/ux-preview`. For `i18n/{vi,en}.ts`, add keys only in the `workflow`, `nextStep`, `assets` and `regions` sections.

Read ADR-022, ADR-028 and ADR-029 in `docs/DECISIONS.md`.

## Fixes (user feedback, real app)

### 1. Going back re-asks every later step

Today `reopenStep` (`packages/domain/src/workflow/workflow.ts` ~line 219) marks every later confirmed DNA step `needs_review`. So when the user goes back to Góc máy to add an anchor camera, they must reconfirm every later step one by one. Per ADR-029:
- Reopening a DNA step reopens only that step. Later steps keep `confirmed`.
- Existing `needs_review` rows still read as before. `StepFrame` offers one-click "Xác nhận lại".
  - The nav or overview offers "Xác nhận lại tất cả bước cần xem lại" when two or more steps need review.
- Drop the "later steps will need review" text from the reopen confirm.
- The camera step, when confirmed, shows a "Thêm góc máy" button. It reopens the camera step and opens the add flow; reconfirming is one click.
- Tests:
  - domain: the reopen does not cascade; legacy `needs_review` rows still work.
  - UI: the add-camera flow needs only one confirm.

### 2. Next step

- **Bug.** Every `nextStep.steps.<id>` title shows the raw key, e.g. "nextStep.steps.generate.anchors", because the step ids contain dots and `t()` splits on dots (`features/workflow/NextStepBar.tsx:37`).
  - Map ids to flat keys (e.g. `generateAnchors`) for every step, in vi and en.
  - Add a test that renders the title for every step id and asserts that no title contains `nextStep.`.
  - Grep for any other `t(`...${id}`)` with dotted ids and fix those too.
- **Layout.** The "Bạn đang ở đây: …" hint overlaps the header and logo.
  - Remove the floating hint and the bar at the top of `PropertyPanel` (`components/panels/PropertyPanel.tsx:46`).
  - Render the next step as a compact button inside the `StepFrame` header, next to the step status, lock and confirm controls. It reads "Tiếp: <title> →".
  - On non-step modules (assets, regions, generate…) show the same compact button in the panel header row, without overlapping the title.
  - Overview keeps the large card.
  - Test: no overlap is structurally possible, meaning the button sits in the header flex row and not absolutely positioned.

### 3. Image strip crops images

The bottom tray thumbnails use `object-fit: cover`, so the frame is cropped.
- Show the whole image (`contain`) on a neutral letterbox background, in the strip and in the contact sheet cards.
- Keep the labels readable: move them below the image instead of on top of it.

### 4. Region panel text overlap

In "Chỉnh vùng", the next-step card overlaps the uppercase help text "VẼ VÙNG, ĐẶT NHÃN…". Fix the layout:
- no absolute overlap
- help text in normal case, not uppercase
- spacing consistent with other panels

### 5. Image strip view modes

Add a view toggle in the tray header: "Lưới nhỏ" (current), "Ảnh lớn" (large thumbnails, about 220 px tall, wrapping grid) and "Danh sách".
- **Danh sách** is a list with a small thumbnail, name, role, model, size, date and status.
- Persist the choice per user in `localStorage`, wrapped in try/catch.
- Tests: switching views, and the list columns.

### 6. Oblique anchors are almost frontal

With pc-1.5.0 the GPT Image anchors for `oblique_street` came out nearly frontal. In `packages/domain/src/prompt`:
- The oblique viewpoint phrase becomes `<front-left|front-right> oblique street view from eye level, about 30–35° off the facade axis, looking along the street`.
- Keep the side hidden. Bump the compiler to `pc-1.5.1` and update the snapshots deliberately.

## Done when

- `npm run verify` is green.
- `npx prettier --check .` is clean.
- `docs/agent-notes/ux-fix-2.md` is written.
