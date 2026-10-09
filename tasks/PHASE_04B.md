# Phase 4B — Guided workflow (ADR-022, API §13)

The user asked for this after testing Phase 4, because users get confused about which tab to use when.

## Goal

Restructure the workspace into a guided pipeline:

1. **DNA thiết kế:** Kiến trúc, Bối cảnh, Tham chiếu, Góc máy, Ánh sáng.
2. **Tạo ảnh:** Master, Anchor, Render.
3. **Hậu kỳ:** Mood / Chỉnh màu.

**Tổng quan** is the hub: it summarises every step, offers quick edits and links to each sub-tab.

Each DNA step has a "Cách dùng" guide, field hints and a "Xác nhận & khoá" button. Later steps can be viewed but not edited until their prerequisites are done.

## User decisions (2026-10-10)

- **Locked steps:** viewable, read-only, with a banner and a jump button.
- **Camera setup** stays in DNA. Anchor creation/approval and production render move to Tạo ảnh as steps 2–3. A master imported and approved in Tham chiếu completes Master (step 1).
- **Confirming:** confirming with default values is allowed. "Mở khoá" sends later steps to `needs_review` and never deletes images.

## Work split

Steps run in parallel. Coding is by Codex HHTECH, review by default Codex.

| Task | Branch | Owns |
|---|---|---|
| WF-A domain | `wt/wf-domain` | `packages/domain/**` |
| WF-B backend | `wt/wf-backend` | `apps/desktop/src-tauri/**`, `tests/fixtures/backend/**` |
| WF-C UI | `wt/wf-ui` | `apps/desktop/src/**`, `apps/desktop/tests/**` (not fixtures) |

All three implement against API §13 exactly; it is the only shared shape. Integration happens on `wt/wf-integrate`.

## Acceptance

- **New project:** only Kiến trúc is editable; each confirm unlocks the next step. After Ánh sáng is confirmed, Tạo ảnh opens at Master.
- **After a master is approved:** Anchor opens (or is skipped when there are no anchor cameras), and Hậu kỳ opens.
- **Reopening Bối cảnh:**
  - Tham chiếu, Góc máy and Ánh sáng go to `needs_review`.
  - Tạo ảnh (Master) locks until they are re-confirmed.
  - Images remain.
- **Backend:** rejects out-of-order generation (§13.4) even if the UI is bypassed.
- **Existing projects** with an approved master open fully unlocked (migration backfill).
- **Tổng quan:**
  - shows every step's status and a summary
  - quick-edits key fields of unlocked steps
  - has Mở / Xác nhận & khoá / Mở khoá buttons
- **Wording:** the prompt lock is labelled "Ghim" everywhere; the workflow lock is "Khoá bước". All strings exist in vi and en.
- **Checks:** `npm run verify` is green; fmt, clippy and prettier are clean.
