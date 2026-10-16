# ui-source-assist — source-image analysis (ADR-040, UI-5)

Branch `wt/ui-source-assist`. Brief: `docs/agent-tasks/ui-source-assist.md`.

## Goal

`dna_assist` gains mode `source`: one source image plus the user's wish → observed items,
inferred guesses, DNA field proposals, an English change request and what to keep. The UI card
"AI nhận diện từ ảnh" shows it and "Dùng mô tả này" feeds the extra prompt and the ADR-030
proposal diff.

## Done

- **Rust** `src-tauri/src/services/dna_assist.rs`
  - `MODES` includes `source`; `validate_request` refuses `source` unless there is exactly one
    `referenceAssetIds` entry (`VALIDATION_ERROR`). Asset ownership, downscale and the HHTECH
    call are shared with mode `images`.
  - `user_text` for `source`: "Analyse the attached source image." + "User wish:" (or a
    "no wish, keep the design" line). The wish is not stored in `generations.request_json`.
  - `AssistResult.usage` is now `skip_serializing_if = None`. It used to serialize as `null`,
    which the webview schema (`usage?: {...}`) rejects; the new contract fixture caught it.
  - Tests (`dna_assist::tests`): zero/two assets refused; wish text; full roundtrip through a
    local `FakeGateway` registered as `hhtech` (one image sent, JSON mode, history row
    `purpose=assist` without key or wish, cross-project asset refused).
- **Contract fixtures** (`contract_fixtures.rs`, recorded last so older ids stay stable):
  `dna_assist_source` (a separate core with `FakeGateway`), `error_dna_assist_source_count`,
  `error_dna_assist_not_configured`.
- **Domain** `packages/domain/src/assist/index.ts`
  - `AssistMode` + `"source"`; `assistSystemPrompt("source", …)` asks for
    `{observed[], inferred[{text,confidence}], fields[], requestEn, keepEn[]}`.
  - `SOURCE_UNVERIFIABLE_PATHS` (`interior.areaM2`, `interior.ceilingHeightM`) are neither
    offered nor accepted in mode `source` (hidden sizes never become facts).
  - `parseSourceAnalysisReply` reuses the field rules (refactored into `parseFields`), keeps
    observed/inferred apart, clips (12 items × 160 chars, request 600), requires English for
    `requestEn`/`keepEn`. `sourceAnalysisExtraPrompt` builds the extra-prompt text.
- **UI**
  - `features/assist/AssistControl.tsx`: extracted and exported `AssistProposalDiff`,
    `AssistErrorCallout`, `assistErrorKind`, `useAssistSpend`, `useApplyAfterReopen`
    (behaviour of `AssistControl` unchanged; existing tests pass).
  - `features/assist/SourceAnalysisCard.tsx`: props `{ assetId, wish, scope? }`; reads the open
    project from the store. "AI đọc ảnh" → spend confirmation → call. "Dùng mô tả này" appends
    the text once to `generateDraft.extraPrompt` and opens the diff; DNA is written only on
    "Áp dụng N mục" (reopening a confirmed step first). `mergeExtraPrompt` exported.
  - Mock backend: `mockSourceAnalysis(scope)`, same one-image rule.
  - i18n `assist.source.*` (vi + en), CSS `.source-analysis*` in `app.css`.
- `docs/API_CONTRACTS.md` §20 updated.

## Not done / debts

- The card is not mounted anywhere yet: the quick-generate screen and its `analysisSlot` belong
  to `wt/ui-generate`. Wiring there:
  `analysisSlot={<SourceAnalysisCard assetId={sourceAssetId} wish={wish} />}`.
- No dedicated history purpose for `source`; it is `assist` like the other modes (as per ADR-040).

## Test commands

```bash
npm run typecheck && npm run lint && npm test
npx prettier --check .
cd apps/desktop/src-tauri
export CARGO_TARGET_DIR=F:/cargo-targets/ui-source-assist
cargo fmt --check && cargo clippy --offline --all-targets -- -D warnings && cargo test --offline
# fixtures: UPDATE_BACKEND_FIXTURES=1 cargo test --offline contract_fixtures
```

Focused: `npx vitest run apps/desktop/tests/sourceAnalysis.test.tsx apps/desktop/tests/assist.test.tsx packages/domain/tests/assist.test.ts`.

## Pitfalls

- `npm run verify` runs `cargo test` without `CARGO_TARGET_DIR`; export it first (disk D full).
- `useApplyAfterReopen` must apply synchronously on an open step: the old `AssistControl` test
  asserts `onApply` right after the click, an `await` broke it.
- `tests/publishing.test.tsx` ("plans, edits a caption…") and `tests/hhtechModels.test.tsx`
  ("shows tier, quality…") can hit the 5 s timeout when cargo builds run in parallel; they pass
  alone and in a quiet full run.
- In a Rust test, do not hold `core.conn()` while calling a service: the mutex deadlocks and
  the test hangs silently.
- F: is nearly full (≈ 2 GB free). `CARGO_INCREMENTAL=0` keeps the target smaller; the
  `debug/incremental` folder of this branch's own target was removed once to make room.
