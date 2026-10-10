# wt/master-ux — Master approval UX

## Goal

User feedback: after pressing the Master star, Generate still said "Hoàn thành bước 'generate.master'".
Choosing the master and approving it were two separate actions, and the approve button lived only in Overview.

## Done

- **"Use as master" (latest result) now sets and approves the master in one click.**
  It calls `asset_set_master`, then `project_approve_master`.
  Replacing an existing master still asks for confirmation first.
- **"Approve master" button in the latest result** when the master is set but not approved
  (for example, a master chosen in References).
- **Blocked reasons are actionable** (`features/workflow/blockedReason.ts`).
  - The Master step says what to press and where.
  - Other steps show the localized step name instead of the raw id.
- **Top bar:** the "Chờ duyệt Master" badge is a button that opens Overview.
- **Default purpose is Hero.** It was Variation for projects without a master, but ADR-022
  gating blocks variations until a master is approved. The variation and hero hints were
  updated to match.

## Tests

- `npm run verify`: 425 Vitest and 255 Rust tests pass.
- `npx prettier --check .` is clean.
- New file: `apps/desktop/tests/masterApproval.test.tsx`.
