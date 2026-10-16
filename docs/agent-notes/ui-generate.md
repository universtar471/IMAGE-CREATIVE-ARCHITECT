# wt/ui-generate

- Agent: Claude Code (coder)
- Brief: `docs/agent-tasks/ui-generate.md` (ADR-040, UI-3)
- Not committed (per brief).

## Goal

Quick-generate screen for the `create` section: the source picker and the large source image on
the left (about 2/3), the request panel on the right (about 1/3), a plan dialog, and a slot for the
UI-5 analysis card. Submitting uses the existing generate path, gate and spend confirmation.

## Done

- `features/generate/useGenerateSubmit.ts`: the submit path of `GeneratePanel`, extracted
  unchanged (disabled reason, workflow gate, conflict gate on the draft, cost text, spend
  confirmation, `submitGeneration` input). `GeneratePanel` now uses it, so both screens share one
  path. `GeneratePanel` is split into `GenerateProvidersGate` (loading or error state for the
  provider list, exported) and the body. `ProviderSection` is exported for the advanced options.
- `features/generate/quick/` (export from `quick/index.ts`):
  - `QuickGenerateView({ analysisSlot?, initialSourceAssetId?, onOpenFullPanel? })`.
    - `analysisSlot` is a node or `({ asset, wish }) => node`, rendered under the image, above the
      collapsible compiled prompt (`GeneratePromptPreview`).
    - `initialSourceAssetId` serves "use as source" from the library (ui-shell): a
      `structure_sketch` opens on Từ phác thảo, a `master_architecture` on Từ ảnh có sẵn.
    - `onOpenFullPanel`: by default "Tùy chỉnh đầy đủ" shows the existing `GeneratePanel` in the
      request column (with a back link). It first writes the quick choice into the draft, so the
      full panel shows the same source and references.
  - `quickDraft.ts` (pure): maps the quick choice onto the existing `GenerateDraft`:
    - Từ ảnh có sẵn → `source: "dna"`, the chosen `master_architecture` asset as reference 1.
    - Từ phác thảo → `source: "sketch"`, the chosen `structure_sketch` (the panel's sketch mode).
    - Từ mô tả → `source: "dna"`, default references (the panel's DNA mode).
    - Always `purpose: "hero"`. The wish is `extraPrompt`; params and provider stay in the draft.
  - The request panel has the wish, the faithfulness control (image sources only), the aspect
    ratio, the image count (default 1, from `defaultGenerationParams`) and the read-only "Thiết
    kế cần giữ" summary: style, floors, roof, materials and locked DNA sections. Advanced
    options (collapsed) hold the provider and model, image size, quality and seed.
  - The plan dialog ("Xem kế hoạch tạo ảnh") shows what will be made, the source and image,
    faithfulness, the number of images sent, aspect, provider and model, wish and the cost
    estimate, plus the existing `ConflictPanel`. Confirm is disabled on BLOCK and on any pending
    WARN until "Duyệt ngoại lệ". Confirming closes the plan and calls the shared `generate()`,
    so the spend confirmation follows unchanged.
  - Import goes through `useAssetImport` with the role of the source (`master_architecture` or
    `structure_sketch`), and the new asset becomes the source.
- i18n: new `quick` namespace in `en.ts` and `vi.ts`, inserted after `generate` and before
  `enhance`. Vietnamese has full diacritics.
- CSS: `.quick-*` block before the "phase 2: generate" section of `app.css`. Single column
  below 900 px.
- Tests: `apps/desktop/tests/quickGenerate.test.tsx` (15).

## Faithfulness mapping

Generate has no faithfulness or strength parameter (`PreservationMode` belongs to enhance only).
Following ADR-040 ("mapped to existing generation settings"), faithfulness chooses which extra
references go with the source (`referenceAssetIds`), capped at the model's reference limit:

- Giữ ảnh gốc: the source alone.
- Cân bằng (default): plus the material, context, landscape, lighting, mood and camera
  references.
- Sáng tạo: plus the architecture references, whose design language the compiler lets the model
  borrow.

For a sketch source, `resolveGenerateForm` keeps the sketch as image 1 and drops master and
sketch references from the extras, as before.

## Hidden sources and why

- Từ ảnh có sẵn and Từ phác thảo are hidden when the selected model has no image-to-image
  support (`imageToImage === false` or `maxReferenceImages === 0`). The pipeline cannot send a
  source image to such a model. A note names the model and points to Advanced options. Only Từ
  mô tả is offered then.
- Từ ảnh có sẵn lists only `master_architecture` assets. The compiler treats only this role as
  the authoritative design ("match its massing … exactly"). Other roles are only borrowed from
  (architecture, material references) or loose inspiration (`regular_image`, so every generated
  output). Offering them as "the source" would be fake, so they are not listed, and an import from
  this card is stored as `master_architecture`. The project's active master is listed first.

## Debts

- The drop zone is click-to-import (the existing picker). OS file drag and drop is not wired:
  Tauri needs its window drag-drop events, and no other screen uses them yet.
- No Prompt Enhance button in the quick panel. The full panel still has it under "Tùy chỉnh
  đầy đủ".
- When the source is the master, Cân bằng and Sáng tạo differ only when the project has
  architecture references.
- Not mounted: the lead switches `CreateSectionView` (wt/ui-shell) to `QuickGenerateView`
  and plugs `SourceAnalysisCard` (wt/ui-source-assist) into `analysisSlot`.
- The quick choice (source, faithfulness) is screen state. It reaches the store only through
  "Tùy chỉnh đầy đủ", so it resets when the screen remounts. The wish, params and provider
  live in the Generate draft and persist.

## Test commands

- `npx vitest run --project desktop apps/desktop/tests/quickGenerate.test.tsx`
- `npm run verify` (with `CARGO_TARGET_DIR` on another drive; D is nearly full):
  - typecheck and lint pass;
  - Vitest: 86 files, 1049 of 1050 pass;
  - Rust (`CARGO_TARGET_DIR=F:/cargo-targets/main`): 324 pass, 6 ignored live tests.
- The one Vitest failure is `publishing.test.tsx › plans, edits a caption…`, a 5 s timeout.
  The base commit 25a4836 without these changes fails the same way under the current machine
  load (several agents building at once). The file passes alone.
- `npx prettier --check .` passes.

## Pitfalls

- Tests that replace `useStudio`'s `submitGeneration` with a spy must restore it. The store is a
  module singleton and `setState` in `beforeEach` does not reset actions.
- With `hhtech` marked configured in the mock, it becomes the first configured provider
  (the order is gemini, openai, hhtech, local). Tests that expect no spend dialog must pick
  `local_preview`.
- The first `vitest run` from the repo root timed out starting the worker under load.
  `--project desktop` and a re-run worked.
- The session scratchpad is shared with the parallel agents. Give log files a unique name: one
  `verify.log` was overwritten with another worktree's output.
