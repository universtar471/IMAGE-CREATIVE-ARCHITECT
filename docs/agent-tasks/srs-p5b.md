# SRS P5b — Publishing Studio UI, storage and export (ADR-038)

**Branch:** `wt/srs-p5b`. This task starts after `wt/srs-p5a` is merged.

## Read first

- ADR-038 in `docs/DECISIONS.md`.
- SRS §11 and §13.3.
- The merged code in `packages/domain/src/publishing/*`.
- The existing UI and backend:
  - `apps/desktop/src/features/workspace/modules.ts`, where `export` sits at `availableIn: 9`
  - the asset bridge in `apps/desktop/src/lib/*`
  - the Rust migrations and the command pattern in `apps/desktop/src-tauri/src/{commands*.rs,services/*}`
  - `contract_fixtures.rs` and `backendContract.test.ts`

## Scope

1. **Rust storage.**
   - A new migration adds the `publications` table described in ADR-038.
   - Commands: `publication_list`, `publication_get`, `publication_save`, `publication_delete`.
     - Use the `blocking()` pattern.
     - Validate the JSON before saving.
     - Mirror the DTOs in the contract fixtures and the TS contract tests.
   - The mock backend implements the same commands.
   - Tests: a roundtrip test, and a test that old databases still migrate.
   - Add a section to `docs/API_CONTRACTS.md`.
2. **UI** in `apps/desktop/src/features/publishing/`, following SRS §13.3. The screen has:
   - Image selection from approved project assets.
   - A type selector.
   - A `targetPageCount` input.
   - `include_all` / `ai_select`.
   - Paper and density settings.
   - A style gallery: the 16 styles from ADR-038.
   - Random controls (style, layout, smart) with a visible seed, plus page lock toggles.
   - A page editor:
     - swap an image
     - drag between slots
     - edit a caption, showing the fact-ref badge or the "Cần duyệt" badge
     - lock a page
   - A preview.
   - A validation panel that shows the publishing validator codes.

   The module is the `export` workspace module. Set `availableIn` to null once the UI is complete, and rename its label to the publishing studio name in both languages. Strings are Vietnamese with full diacritics, plus English.

   Optional AI captions:
   - A paid text call, made only on explicit click.
   - It goes through the existing provider and gate infrastructure if a text-capable provider exists.
   - Otherwise the button is hidden.
   - Results always land as `needs_review` until the user approves them.
3. **Export.**
   - PNG or JPEG per page, rendered in the webview from the page layout and the source asset files, which are never regenerated.
   - PDF: page images written by a minimal pure-TS PDF writer that embeds JPEG with DCTDecode, at A4, A3 or 16:9 size.
     - Add no new dependency.
     - Unit-test the writer: valid header, xref and trailer; the page count equals `targetPageCount`; the page size is correct.
   - Export is refused while `UNVERIFIED_PUBLICATION_FACT` or `PAGE_COUNT_MISMATCH` is present. `PRINT_READABILITY_LOW` shows a warning and asks for confirmation.
   - Save through the existing save-file bridge. If none exists, add a small Rust command, never a webview download hack.

## Out of scope

Do not touch:
- `packages/domain/src/{diagram,detail,effects,sceneObjects,contextLibrary}/**`
- `features/{diagram,detail,effects,sceneObjects,enhance}/**`

## Done when

- `npm run verify` and `npx prettier --check .` are green.
- In `apps/desktop/src-tauri`, these pass:
  - `cargo fmt --check`
  - `cargo clippy --offline --all-targets -- -D warnings`
  - `cargo test --offline`
- `docs/agent-notes/srs-p5b.md` is written.
- Do not commit. Do not touch `.env`. Make no paid calls in tests.
