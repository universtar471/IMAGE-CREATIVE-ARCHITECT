# wt/p6-domain

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-10 05:11

## Muc tieu

## Da xong

- Added `packages/domain/src/qc/` exports:
  `QcScoresSchema`, `QcArtifactSchema`, `QcIssueSchema`, `QcVisionSchema`,
  `QcLocalSchema`, `QcSettingsSchema`, `QcReportDTOSchema`, the four request
  schemas (`QcRunRequestSchema`, `QcListRequestSchema`,
  `QcSettingsGetRequestSchema`, `QcSettingsSetRequestSchema`), `defaultQcSettings()`,
  `scoreReport(local, vision, thresholds)`, `parseVisionReply(text)`,
  `buildVisionPrompt({ dna, purpose })`, `buildRepairPrompt({ dna, report })`,
  `QC_CATEGORIES`, and `QC_SAME_VIEW_PURPOSES`.
- Added `repair` generation purpose, `RepairParamsSchema` with required
  `params.repair.qcReportId`, exactly-two-reference validation, QC ID prefix,
  and variation-equivalent workflow gating.
- Added `packages/domain/tests/phase6.test.ts` with scoring branches, parser
  normalization/errors, schema validation, prompt snapshots, and gating tests.

## Con no

- Desktop typecheck remains blocked outside this branch's scope because the
  UI translation key union has not yet added `labels.purpose.repair` in
  `ContactSheet.tsx`, `HistoryTab.tsx`, and `VersionsTab.tsx`.

## Lenh test

- `.\\node_modules\\.bin\\vitest.cmd run packages/domain/tests` (170 passed)
- `npm.cmd run typecheck --workspace @arch/domain` (passed)
- `npm.cmd run lint -- --quiet` (passed)
- `.\\node_modules\\.bin\\prettier.cmd --check packages/domain/src packages/domain/tests/phase6.test.ts docs/agent-notes/p6-domain.md` (passed)
- `git diff --check` (passed)
- `npm.cmd run verify` (stopped at desktop typecheck; see above)
- `npm.cmd run schema:export` (blocked by the known sandbox
  `uv_os_get_passwd returned ENOMEM` error; no schema file was changed)

## Cam bay da gap

- `npx` is blocked by PowerShell execution policy and `npm exec` attempted a
  locked global npm cache; use the checked-in `node_modules/.bin` commands.

