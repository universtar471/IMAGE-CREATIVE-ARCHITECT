# SRS P5a — Publishing Studio domain (ADR-038)

Branch `wt/srs-p5a`. Domain only (`packages/domain/src/publishing/`), no UI, no Rust.
The earlier Codex start (schemas, styles, layouts, planner, randomize) was reviewed: the
style library was kept; schemas, layouts, planner and randomize were rewritten (see
"Fixed from the Codex draft").

## Done

- `schemas.ts`: publication types, papers, selection modes, `PublicationInput`
  (`selectedImageIds` + `assets` records with `sourceHash`, size, optional `group`
  evidence, `importance`), `Page` with `image | text | caption` slots, `CaptionSlot`
  (`textKind`, sentences with `factRef` + `needs_review`), `Publication` pinning every
  selected image by `assetId` + `sourceHash`. `layoutTemplateId` is null for cover/text
  pages that have no image frames.
- `styles.ts`: the 16 SRS §11.2 styles (palette, fonts, type scale, spacing, margins,
  divider, caption, cover rules); `resolvePublicationStyle(type, id)` falls back to the
  type's first style.
- `layouts.ts`: the 9 ADR-038 templates as normalized rects for A4, A3 (portrait) and
  16:9 (landscape). Pages have header band / content box / footer band; templates only
  move image frames. `fitRects` always returns exactly `count` rects (overflow area or
  flexible grid).
- `planner.ts` `planPublication`: exact `targetPageCount`; `include_all` places each
  image once; `ai_select` keeps a budget (portfolio 5, magazine 4, catalog 9, concept 10
  per page) ranked by importance, seeded tie-break, Concept keeps the best of each
  evidenced group; reasons recorded for kept and omitted images. Pages > images → cover,
  one image per page, then diagram (Concept) or text pages; no invented images. Cover
  reuses the hero only with `allowImageRepeat`. Auto layout: Concept ≥4 → `dense_contact`
  (main + thumbnails ordered context→massing→space→detail, one caption per evidenced
  group); Portfolio → `hero_plus_secondary` / `hero_full_page`, no headline; Catalog →
  labelled grids; Magazine → headline + `asymmetric_editorial` dominant frame. Dense
  pages get `dense_page_suggest_a3_or_digital`.
- `randomize.ts`: `style | layout | smart`; choices depend only on `seed` + page id, so
  an old seed restores the old result from any state; locked pages are cloned unchanged;
  only image rects/template change, slot ids, assets, text and captions never move.
- `factClaims.ts`: `detectFactClaims` (year, number, place, award, brand, author) in
  Vietnamese with/without diacritics and English, reusing `prepareText` folding.
- `validate.ts` `validatePublication(pub, assets, { facts, approvedExceptions })`:
  returns the shared `ShotValidation` shape with `ConflictIssue`s from the single code
  table (`PAGE_COUNT_MISMATCH`, `REQUIRED_IMAGE_MISSING`, `PRINT_READABILITY_LOW`,
  `UNVERIFIED_PUBLICATION_FACT`); severities come from `CONFLICT_CODES`. Readability
  reasons: `low_ppi` (150 print / 96 for 16:9), `image_too_small` (< 56 pt), `dense_page`,
  `font_too_small`, `text_overflow` (estimate), `unsafe_crop` (< 60 % kept).
- `captions.ts`: `buildCaptionPrompt` (SRS §11.4 prompt verbatim + confirmed facts only
  + open caption slots, JSON answer format; no provider call), `applyCaptionDrafts`
  (writes only existing slots on unlocked pages, drops unconfirmed refs, sets
  `needs_review`), `annotateCaptionReview`.
- Exported via `publishing/index.ts` and `src/index.ts`.

## Fixed from the Codex draft

- Images were cycled through context/massing/space/detail by index (invented evidence);
  groups now come only from `asset.group`.
- Plain string ids got a fake `unresolved:` hash; every selected id now needs an asset
  record (`PublicationPlanError`).
- Randomize fitted text/caption slots into image rects and chose relative to the current
  layout (an old seed could not restore); both fixed.
- Templates were identical for every paper; 16:9 now has landscape geometry.
- Validator types were a private copy; now the shared `ConflictIssue`/`verdictOf`.

## Tests

`packages/domain/tests/srs-p5a-publishing.test.ts` (66 tests): AC-16..AC-19, exact page
count for 1/3/10 pages × both modes × 4 types, pages > images, seed reproducibility,
locked pages, vi/en claim detection, effective PPI.

```
export CARGO_TARGET_DIR=F:/cargo-targets/srs-p5a
npm run verify
npx prettier --check .
```

## Open / limitations

- Style randomising is book-wide, so it also restyles locked pages (their content and
  layout stay identical). Per-page style overrides are not modelled.
- Headlines and titles are fact-checked like captions: a user title with a year or place
  blocks until linked to a `user_declared` fact (`TextSlot.factRef`).
- Duplicate placement under `include_all` without repeat has no dedicated code; the
  planner never produces it.
- Overflow is a character-count estimate, not text measurement; the claim detector is a
  keyword/regex heuristic (eager on purpose) with a short brand and place list.
- No storage, commands or export (P5b).
