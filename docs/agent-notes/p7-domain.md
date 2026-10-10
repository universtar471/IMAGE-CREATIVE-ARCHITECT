# wt/p7-domain

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-10 06:33

## Muc tieu

Implement Phase 7 domain contract in `packages/domain/**`: region/scene schemas, deterministic masks and vectors, region-edit prompt, compiler pin preservation, generation purpose/capability/gating.

## Da xong

- Added `packages/domain/src/regions/` with exact region/scene/request schemas, mask rasterisation (pixel centres, even-odd polygons, brush discs/capsules), 3-pass box feathering, scene helpers and region-edit prompt.
- Added `GenerationPurposeSchema` value `region_edit`, `params.region` validation including exactly one reference, `supportsMask` default false, batch validation, and variation-equivalent gating.
- Added additive `dna.scene`, pinned-object preservation lines, compiler `pc-1.3.0`, and regenerated the checked-in Project DNA JSON Schema.
- Added `packages/domain/test-vectors/masks.json` covering rect, concave and self-intersecting polygons, brush with two strokes, union and feathering; Phase 7 tests regenerate and compare vectors.

## Con no

- UI i18n labels for `region_edit` are outside this branch (`apps/desktop`); root typecheck reports three expected missing translation-key errors until the UI agent adds the strings.

## Lenh test

- `npm.cmd run typecheck -w @arch/domain` (pass)
- `node_modules\\.bin\\vitest.cmd run packages/domain/tests` (180 passed)
- `npm.cmd exec -- eslint packages/domain/src packages/domain/tests` (pass)
- `node_modules\\.bin\\prettier.cmd --check` on changed domain files (pass)
- Vector generation: bundled `src/regions/vectors.ts` with esbuild and ran Node because `tsx` hits sandbox `uv_os_get_passwd ENOMEM`.
- Schema generation: bundled `scripts/export-json-schema.ts` with esbuild and ran Node for the same reason.
- `npm.cmd run typecheck` (domain pass; desktop fails only the three missing `labels.purpose.region_edit` keys noted above).

## Cam bay da gap

- The sandbox raises `uv_os_get_passwd returned ENOMEM` from `tsx` before scripts execute. The checked-in schema and vectors were generated through an esbuild bundle + Node workaround; normal `tsx` commands should work outside this constrained sandbox.
- No live paid API calls were made. No commit was created.

