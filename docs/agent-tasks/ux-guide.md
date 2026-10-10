# UX guidance: next-step bar, spend confirmation, re-run one anchor, lock explainer

Branch: `wt/ux-guide`. You own `apps/desktop/src/**` and `apps/desktop/tests/**`.

Do not change `packages/domain` or `src-tauri`. If you truly need a domain helper, put it in `apps/desktop/src/lib` and note it.

## Context

A real non-expert user (Vietnamese architect) got lost:
- They did not know what to do next.
- They were afraid of wasting paid HHTECH credit.
- When an anchor came out wrong, they had to re-run all anchors.
- Locked steps only named the blocking step; they did not explain it.

Read first:
- `docs/DECISIONS.md` ADR-022 and `docs/API_CONTRACTS.md` §13 (workflow)
- `apps/desktop/src/lib/workflow.ts`, `features/workflow/StepFrame.tsx`, `features/workflow/blockedReason.ts`
- `features/overview/OverviewPanel.tsx`, `features/generate/{GeneratePanel,GenerationResult,form}.tsx`
- `features/camera/{BatchDialog.tsx,batch.ts,ContactSheet.tsx}`
- `app/store.ts` (`submitGeneration`, `createBatch`)
- `i18n/{vi,en}.ts`

## Scope

1. **Next-step bar.**
   - Add a slim bar at the top of the right property panel on every workspace module except Export.
   - It also shows as a large CTA in Overview.
   - Derive the step from a pure function `nextStep(workspace, workflowView)` in `src/lib/nextStep.ts`. It returns `{ id, title, action, module, focus? }`, in this order:
     1. the first DNA step not confirmed → "Xác nhận bước {tên}"
     2. no master → "Tạo ảnh Hero rồi bấm Dùng làm Master"
     3. master pending → "Duyệt ảnh Master"
     4. anchor cameras without an approved anchor → "Tạo / duyệt Anchor cho {n} góc"
     5. no production render yet → "Render các góc máy"
     6. otherwise → "Hậu kỳ: chỉnh màu, nâng cấp, QC"
   - The button "Đi tới" switches to the module.
   - Hide the bar when the user is already on that module. In that case show only a short hint line.
   - Strings in vi and en.
2. **Spend confirmation** before every paid submit from the UI:
   - which submits:
     - Hero and variation (`GeneratePanel`)
     - anchor and production batches (`BatchDialog`)
     - generative enhance
     - QC vision
     - repair
     - "Tạo lại"
   - "Paid" means the provider is not `local_*`.
   - The dialog "Xác nhận chi phí" shows:
     - provider and model
     - the number of images (items × outputs)
     - the estimated total, reusing the existing cost hint helpers (`costHintText` and the batch cost)
     - "Chưa có ước tính giá" when there is no price
   - Buttons: "Tạo ảnh" and "Hủy".
   - Checkbox "Không hỏi lại khi dưới [N] đ". The default N is 2000. Store it in `localStorage` with try/catch, as a UI preference only. Add a reset link in the dialog.
   - Implement it once as a reusable hook or component, `useSpendConfirm()`. Do not copy the dialog per panel.
3. **Re-run one anchor.**
   - On the contact sheet (Bảng ảnh), each anchor camera group gets "Tạo lại góc này".
   - It creates a batch with only that camera, using the provider, model and params of the batch the group came from. It goes through the spend confirmation.
   - It never replaces an approved anchor. The user still approves a result.
   - Also add it in `BatchDialog` as a per-camera checkbox list. Anchor mode currently runs all anchor cameras; let the user untick cameras, with all ticked by default.
4. **"Vì sao đang khóa?"**
   - On every locked `StepFrame` and on every generation-blocked reason (`blockedReason`), add an expandable explainer per blocking step.
   - It explains why that step is a prerequisite, in 1–2 sentences, vi and en. For example: "Anchor giữ góc nhìn cố định cho từng camera; render sản xuất dùng Anchor để mọi ảnh cùng một công trình".
   - Include the "Đi tới bước này" button.
5. **Tests**
   - the `nextStep` order with fixtures for every branch
   - bar visibility per module
   - spend confirmation:
     - shown for paid providers, skipped for `local_*`
     - the threshold remembered
     - cancel does not submit
   - re-run one anchor sends a batch with exactly one camera and the source batch settings
   - BatchDialog camera untick
   - the explainer renders for each step id
   - i18n parity and the diacritics guard (proper Vietnamese diacritics; no unaccented Vietnamese)

## Done when

- `npm run verify` is green.
- `npx prettier --check .` is clean.
- `docs/agent-notes/ux-guide.md` is written.
