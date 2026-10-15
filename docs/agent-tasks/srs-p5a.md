# SRS P5a — Publishing Studio domain: page budget, styles, layouts, fit and fact rules (ADR-038)

**Branch:** `wt/srs-p5a`. This task covers the domain only: no UI and no Rust.

## Read first

- In `docs/DECISIONS.md`: ADR-038 and ADR-034.
- In the SRS: §11, plus AC-16 to AC-19.
- `packages/domain/src/facts/*` and `validation/*`.

## Scope (`packages/domain/src/publishing/`)

1. **Schemas.** Write Zod schemas for these, with the fields named in ADR-038:
   - publication types;
   - `PublicationInput`;
   - `Page`, made of slots, each slot holding `image | text | caption`;
   - `Publication`, which pins every asset by `assetId` plus `sourceHash`;
   - `CaptionSlot`, with `textKind`, sentences, a `factRef` per sentence and the `needs_review` flag.
2. **Style library.** Build the 16 styles named in SRS §11.2, four for each type. Each style carries:
   - a palette;
   - font families and a type scale;
   - spacing and margins;
   - divider, caption and cover rules.
3. **Layout templates.** Use the list from ADR-038. Store each template as normalized slot rectangles for A4, A3 and 16:9.
4. **`planPublication(input)`**, deterministic for a given `seed`.
   - It returns exactly `targetPageCount` pages.
   - `include_all` places every image exactly once; `ai_select` chooses a subset and records the reason for each choice.
   - When there are more pages than images, the extra pages are text, cover or diagram pages. It never invents images.
   - Layout choice depends on the publication type:
     - With 10 images on 1 page, `concept_book` uses the dense contact layout, grouped by context, massing, space and detail where the evidence allows (AC-16).
     - `portfolio` uses a hero-led layout and must not reuse the concept layout (AC-17).
     - `catalog` uses a grid with labels.
     - `magazine` uses an editorial headline and a dominant image.
5. **`randomize(pub, level: style | layout | smart, seed)`.**
   - The same seed gives the same result.
   - Pages in `lockedPageIds` are never changed (AC-18).
   - Content and facts are never reshuffled.
6. **`validatePublication(pub, assets)`**, registered with the single validator's codes:
   - `PAGE_COUNT_MISMATCH`;
   - `REQUIRED_IMAGE_MISSING`;
   - `PRINT_READABILITY_LOW`: effective PPI below 150 for print, font size below the minimum, overflow, or an unsafe crop;
   - `UNVERIFIED_PUBLICATION_FACT` (BLOCK): a sentence with a number, place, year, award, brand or author and no confirmed `factRef` (AC-19).

   Add a small detector for sentences that make factual claims, in Vietnamese and English.
7. **`buildCaptionPrompt(pub, facts)`.** Use the SRS §11.4 editorial prompt with only verified facts, and return structured slots. This step builds the prompt only; it makes no provider call.
8. **Tests.**
   - AC-16 to AC-19.
   - The exact page count, with 1, 3 and 10 pages, for both modes.
   - More pages than images.
   - Seed reproducibility.
   - Locked pages.
   - Detecting a fact claim in Vietnamese with diacritics and in English.
   - Effective PPI.

## Out of scope

- UI, Rust and export: these are P5b.
- Do not touch:
  - `packages/domain/src/{diagram,detail,effects,sceneObjects,contextLibrary}/**`
  - `apps/**`

## Done when

- `npm run verify` and `npx prettier --check .` are green.
- `docs/agent-notes/srs-p5a.md` is written.
- Do not commit. Do not touch `.env`. Make no API calls.
