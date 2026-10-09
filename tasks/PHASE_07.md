# Phase 7 — Scene graph / Region editing (ADR-025, API §16)

ROADMAP Phase 7. The lead planned it overnight, following the user's instruction to continue with the next phases; the user will check in the morning.

## Goal

The new module is **Hậu kỳ › Chỉnh vùng**:

- Draw regions on an image: rectangle, polygon and brush (eraser = delete stroke or region).
- Label each region and link it to a project scene object.
- Run selective edits on one or more regions: either a free instruction, or material replacement ("đổi vật liệu").
- Outside the mask, the result is guaranteed unchanged (local composite).

The project scene graph adds:
- objects with categories and materials
- simple relations
- pinning objects so prompts preserve them

Auto-select is deferred: it needs a segmentation model. Show it disabled as "Phase sau".

## Constraints

- No live paid calls in tests. Use the mock HTTP server; live tests stay `#[ignore]`.
- The source is never modified. Outputs are new assets and versions.
- The mask rasterisation is identical in TS and Rust (shared vectors).

## Work split

Run in parallel. Codex HHTECH writes the code; default Codex reviews.

| Task | Branch | Owns |
|---|---|---|
| P7-A domain | `wt/p7-domain` | `packages/domain/**` |
| P7-B backend | `wt/p7-backend` | `apps/desktop/src-tauri/**`, `tests/fixtures/backend/**` |
| P7-C UI | `wt/p7-ui` | `apps/desktop/src/**`, `apps/desktop/tests/**` (not fixtures) |

API §16 is the single shared contract. Integration happens on `wt/p7-integrate`.

## Acceptance

- Regions persist per asset, and editing a region updates it.
- Deleting an asset removes its regions.
- **Mask vectors:** TS and Rust masks are identical on the shared vectors.
- **Region edit (mock provider):**
  - native-mask models get `mask`
  - non-mask models get the mask as a second image
  - pixels outside the feathered mask equal the source exactly
- **Material replace:** the prompt names the region label/object and the material, and preserves geometry.
- **Pinned scene objects:** they appear as preservation lines in the compiled prompt (`pc-1.3.0`).
- **Strings:** vi + en.
- **Checks:** `npm run verify` is green; fmt, clippy and prettier are clean.
