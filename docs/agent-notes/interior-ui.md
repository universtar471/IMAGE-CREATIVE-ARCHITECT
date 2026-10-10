# wt/interior-ui

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-10 20:16

## Muc tieu

Implement ADR-027 / API §18 interior UI on `wt/interior-ui` without live provider calls.

## Da xong

- Added `apps/desktop/src/lib/interior.ts` as the single-file domain stand-in. It contains the
  §18 ids, Vietnamese/English labels, room/furniture rules, style defaults, material presets,
  surface swatches, default DNA and non-mutating legacy proposal helper. The module is marked
  `TODO(interior-domain)` for the integration swap.
- Updated the project wizard and application service to create additive `dna.interior` for new
  interior projects; the in-memory backend and autosave preserve the additive section.
- Added the interior Space editor, cascading use/room selection, style confirmation, palette and
  seven surface multi-selects, room furniture suggestions, density/dimensions, live moodboard and
  legacy proposal confirm/cancel flow.
- Added interior Context (window/view/daylight), Lighting (time, scene chips, temperature), and
  Camera (four quick presets, 1.35 m height, 20 mm default, 35 mm detail) variants.
- Added interior Overview summary/moodboard, localized vi/en strings, responsive styles and
  explicit UI tests in `apps/desktop/tests/interior.test.tsx`.

## Con no

- The catalog/schema/compiler exports remain stand-ins until `wt/interior-domain` lands. The
  integrator should replace imports in `lib/interior.ts` with `@arch/domain` exports and remove
  the temporary additive preservation bridge once the domain schema includes `interior`.

## Lenh test

- `npm.cmd run verify` — green (40 files, 479 Vitest tests; Rust 264 passed, 6 ignored live-smoke tests).
- `npx.cmd prettier --check .` — green.

## Cam bay da gap

- No paid/live API calls were made. Provider live-smoke tests remained ignored by their existing
  key-gated configuration.

