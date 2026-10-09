# wt/p5-domain

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-10 03:17

## Muc tieu

## Da xong

- Added `GenerationPurposeSchema` value `enhance` and `EnhanceParamsSchema` with the §14.1
  shape/defaults (`detailStrength = 40`, `architecturePreserve = true`). Generation submit,
  DTO, and batch schemas enforce required `params.enhance`, conservative target, and
  `providerId = "local_upscale"`.
- Exported `ENHANCE_TARGETS`, `MAX_ENHANCE_EDGE`, `buildEnhancePrompt({ dna, params })`, and
  `buildEnhanceItems({ sources, params, providerId, model, dna? })` from `@arch/domain`.
  The item builder emits one source-only reference per item, `Enhance — <asset name>` labels,
  an empty prompt for conservative mode, and a deterministic generative prompt otherwise.
- Extended `isGenerationAllowed("enhance", ...)` to use variation's approved-master gate.
- Added `packages/domain/tests/phase5.test.ts` covering schema defaults/refinements, prompt
  buckets/materials/preservation, batch item behavior, reference capability errors, and gating.

## Con no

- `npm run schema:export` could not start in this environment: Node/tsx fails in
  `uv_os_get_passwd` with `ENOMEM`. The command did not modify the checked-in schema; this
  phase changes generation/job schemas, not persisted `ProjectDNA`.

## Lenh test

- `npm.cmd run typecheck --workspace=@arch/domain` (pass)
- `npm.cmd test -- --run packages/domain` (10 files, 154 tests pass)
- `npx.cmd prettier --check packages/domain/src packages/domain/tests/phase5.test.ts` (pass after format)
- `npm.cmd run schema:export` (blocked by Node `uv_os_get_passwd ENOMEM`)

## Cam bay da gap

