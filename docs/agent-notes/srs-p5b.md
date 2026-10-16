# SRS P5b — Publishing Studio UI, storage and export (ADR-038)

Branch `wt/srs-p5b` (agent: claude). Builds on the merged P5a domain
(`packages/domain/src/publishing/*`), which was not rewritten. Not committed (per the brief).

## Done

### Domain (additive only)
- `publishing/document.ts`: `PublicationDocumentSchema` (`{ publication, facts }`), the bridge DTO
  schemas `PublicationRecordDTOSchema`, `PublicationSummaryDTOSchema`, `PublicationSaveRequestSchema`.
- `jsonSchema.ts`: `publicationDocumentJsonSchemaText()`; `npm run schema:export` now also writes
  `packages/domain/schema/publication-document.schema.json` (drift test in `tests/jsonSchema.test.ts`).
- `test-vectors/publication-document.json`: a planned 2-page Portfolio (used by Rust tests,
  fixtures and the TS contract test).

### Rust
- `migrations/0009_publications.sql`: `publications(id, project_id, json, created_at, updated_at)`,
  cascade on project delete, index `(project_id, updated_at)`. No asset FK on purpose (pins live in JSON).
- `services/publications.rs`: list/get/save/delete with JSON Schema validation (+ ≥1 page, 4 MB cap,
  archived = read-only), `caption_draft` (provider `chat`, same gate as `prompt_enhance`),
  export file checks (`decode_export_files`) and writing (`write_export`, no overwrite in folder mode).
- `commands.rs`: `publication_list|get|save|delete|caption_draft|export_save`, all `blocking()`.
  `publication_export_save` opens the native dialog in Rust (`tauri_plugin_dialog::DialogExt`,
  already a dependency): save-file for PDF, pick-folder for PNG/JPEG. No capability change needed.
- `contract_fixtures.rs`: `PUB_` ids normalised; fixtures `publication_save|list|get|delete|caption_draft`,
  `publication_export_save_cancelled`, `error_publication_invalid` (recorded after `version_list`
  so older fixtures keep their ids).
- `db.rs`: table list updated; `migration_0009_adds_publications_to_a_v8_database`.
- `util.rs`: prefix `PUB`.

### UI (`apps/desktop/src/features/publishing/`)
- `publishing.ts` (pure): publishable assets (ready + sha256 + size, roles master/regular),
  settings → `planPublication`, `publicationIssues` (validator + unapproved AI sentence =
  `UNVERIFIED_PUBLICATION_FACT` reason `needs_review`), `exportGate`, edits (`swapImages`,
  `replaceImage`, `setCaptionText`, `setSentenceFact`, `approveCaption`, `setText`, `setTextFact`,
  `toggleLock`), `applyAiCaptions` (forces `needs_review`), seeds.
- `store.ts` (zustand): settings, book, facts, selection, records, save/open/delete.
- `PageView.tsx`: page in DOM with the book's style (cqw font sizes), frame selection,
  HTML5 drag-and-drop swap; thumbnails render non-interactive divs.
- `PublishingStudio.tsx` (center): toolbar (kind, layout, lock, export preview), page editor +
  inspector (image replace, caption editor with per-sentence fact select, "Cần duyệt"/fact badges,
  approve; text slot editor), page strip with lock and issue counts, export preview dialog that
  uses the real renderer at half size.
- `PublishingPanel.tsx` (right): saved books, settings (type, images, policy, page count, paper,
  density, title, cover repeat, plan/re-plan), 16-style gallery (picking another type's style
  switches the type and needs a re-plan), random (seed field + new seed, style/layout/smart),
  confirmed facts, AI captions (hidden unless `hhtech` is configured; spend confirm first),
  validation panel (code, reason, go to page, accept warnings), export (PDF/PNG/JPEG).
- `render.ts` (draw ops, wrap, cover/contain fit, export pixel sizes), `exporter.ts` (canvas,
  `asset_preview` sources, encode, PDF, `publication_export_save`), `pdf.ts` (pure PDF writer).
- `export` module: `availableIn: null`, label "Publishing Studio" / "Studio xuất bản",
  center tabs hidden in this module. i18n `publishing.*` in en + vi (full diacritics).
- Mock backend implements all six commands (export returns `mock-export://` paths, writes nothing).

## Tests

- `apps/desktop/tests/publishingPdf.test.ts` (12): header/xref/trailer offsets, DCTDecode embed,
  page count = targetPageCount (1/3/10), MediaBox A4/A3/16:9, UTF-16 title, base64 chunks, jpegInfo.
- `apps/desktop/tests/publishing.test.tsx` (17): helpers, render geometry, mock storage, module/i18n,
  UI flows (plan → caption claim → blocked → link fact → unblocked → save; random with lock;
  AI captions hidden/shown, spend gate, drafts need review).
- Rust: 8 in `services::publications`, 1 migration test, contract fixtures.
- Manual: browser preview (mock) — plan, caption + fact, export preview render, PNG export with
  the readability confirm. A PDF built from real Chrome canvas JPEGs and from PIL RGB/gray/
  progressive JPEGs opened in PyMuPDF and `pypdf` (strict) with the right page sizes and title.

```
export CARGO_TARGET_DIR=F:/cargo-targets/srs-p5b
npm run verify
npx prettier --check .
cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy --offline --all-targets -- -D warnings && cargo test --offline
```

## Open / limitations

- Export refuses every BLOCK (also `REQUIRED_IMAGE_MISSING`), not only the two codes in the brief.
- The Tauri export path (native dialog + writing) was not run in the real app here; its pieces
  are unit-tested in Rust, the dialog call itself is not. Canvas rendering is not covered by
  vitest (jsdom has no canvas); it was checked in the browser preview.
- Text is rasterised into page images (ADR-038 MVP); fonts are whatever the webview has
  (style font stacks fall back to Arial/Georgia/Consolas).
- Facts are per book (declared in the studio), not a project-wide fact store.
- Re-plan is disabled while any page is locked (re-planning replaces every page).
- Caption word limits are shown, not enforced; overflow is ellipsised in the export and the
  validator warns (P5a estimate).
- AI captions use the HHTECH chat gateway only (the only text-capable provider); the model is the
  gateway's chat default.
- Large books are sent to Rust as base64 JSON in one call (fine for tens of A3 pages, not optimised).
