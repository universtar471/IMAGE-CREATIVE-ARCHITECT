# wt/wf-domain

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-10 01:13

## Muc tieu

## Da xong

- Them `packages/domain/src/workflow/schemas.ts`: `WORKFLOW_STEPS`, `WorkflowStepIdSchema`,
  `DnaStepIdSchema`, persisted state/DTO schemas va request schemas cho ba lenh workflow.
- Them `packages/domain/src/workflow/workflow.ts`: `deriveWorkflow(persisted, facts)`,
  `confirmStep(persisted, stepId, now)`, `reopenStep(persisted, stepId)`,
  `isGenerationAllowed(purpose, persisted, facts)` va cac type view/facts.
- Export toan bo workflow tu `packages/domain/src/index.ts`.
- Them `packages/domain/tests/workflow.test.ts` voi 14 test cho unlock chain, skip, cascade,
  gating va error cases.

## Con no

- Khong con thay doi trong pham vi `packages/domain/**`; khong commit theo yeu cau.

## Lenh test

- `cmd /c npm exec -- vitest run packages/domain/tests/workflow.test.ts` (14 passed)
- `cmd /c npm run typecheck -w @arch/domain` (passed)
- `cmd /c npm run verify` (passed: typecheck, lint, 335 Vitest tests, Rust 227 passed / 5 ignored).
- `cmd /c npm run schema:export` (blocked by environment: Node `uv_os_get_passwd returned ENOMEM`;
  the checked-in schema had no diff, and the schema drift test passed in the full suite).

## Cam bay da gap

- PowerShell execution policy chan truc tiep `npm`/`npx`; dung `cmd /c npm ...` de chay lenh.
- Section 13.2 khong liet ke camera ids khong phai anchor trong `facts`; helper chap nhan them
  `cameraIds?` de phan biet truong hop co camera nhung khong co anchor view theo acceptance.

