# UI source assist — analyse the source image (ADR-040, UI-5)

**Branch:** `wt/ui-source-assist`.

## Read first

- ADR-030 and ADR-040 in `docs/DECISIONS.md`; `docs/API_CONTRACTS.md` §20.
- `packages/domain/src/assist/index.ts`, `apps/desktop/src/lib/assist.ts`, `features/assist/AssistControl.tsx`, `apps/desktop/src-tauri/src/services/dna_assist.rs`, the mock backend, `contract_fixtures.rs`, `backendContract.test.ts`, `features/generate/extraPrompt.ts`.

## Scope

1. **Rust.** `dna_assist` accepts mode `source`:
   - exactly one `referenceAssetIds` entry, otherwise `VALIDATION_ERROR`;
   - optional `brief` holds the user's wish;
   - same image handling and HHTECH call as mode `images`.
   - The mock backend returns a canned reply. Update the fixture and contract tests. No live call in tests.
2. **Domain.** The `assist` module gains the `source` mode:
   - a system prompt asking for JSON `{ observed[], inferred[{ text, confidence }], fields[], requestEn, keepEn[] }`;
   - a parser that applies the same catalogue rules, drops unknown ids, clips text and requires English for `requestEn` and `keepEn`.
   - Inferred items never become verified facts.
3. **UI.** `features/assist/SourceAnalysisCard.tsx`, exported for the quick-generate `analysisSlot` and usable standalone with an asset id and a wish:
   - a button "AI đọc ảnh" with the same spend confirmation as the other assist modes;
   - observed and inferred lists labelled "Thấy trong ảnh" and "Suy luận";
   - "Dùng mô tả này" opens the existing proposal diff for `fields` and writes `requestEn` and `keepEn` into the extra prompt.
4. Update `docs/API_CONTRACTS.md` §20.

## Tests

- Rust: `source` with zero or two assets is refused; the request roundtrips.
- Domain: the parser keeps observed and inferred apart, drops unknown ids and clips text.
- UI: no call before the click; the spend confirmation is shown; applying writes the extra prompt and goes through the diff.

## Out of scope

- `features/generate/**` (another branch), the nav, the wizard, the compiler.

## Done when

- `npm run verify` and `npx prettier --check .` pass.
- In `apps/desktop/src-tauri`, with `CARGO_TARGET_DIR=F:/cargo-targets/ui-source-assist`: `cargo fmt --check`, `cargo clippy --offline --all-targets -- -D warnings`, `cargo test --offline`.
- `docs/agent-notes/ui-source-assist.md` is written.
- Do not commit. Do not touch `.env`. Make no paid calls.
