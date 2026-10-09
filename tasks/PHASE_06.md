# Phase 6 — Vision QC (ADR-024, API §15)

This is ROADMAP Phase 6. The lead planned it overnight, on the user's instruction to keep going with the next phases; the user will check in the morning.

## Goal

Hậu kỳ › QC scores a finished image against its references and helps fix it:

- **Local metrics:** free and deterministic.
  - edge alignment against the reference, for same-view outputs
  - sharpness
  - clipping
- **Optional AI vision judge:** scores geometry, material, openings, context and lighting, lists artifacts with boxes, and writes a repair instruction. It runs on HHTECH / OpenAI chat with images and is paid.
- **Thresholds:** per project, deciding pass / warn / fail / unscored.
- **"Sửa theo QC":** a repair generation built from the report.
- **Optional automation:** QC after generation, and auto-repair up to N times. Both are off by default.
- **QC overlays:** artifact boxes drawn on the canvas.
- **QC badges:** on tray and Contact Sheet items.

## Constraints

- No live paid calls in tests. Use the mock HTTP server, and keep live tests `#[ignore]`.
- QC never modifies assets. Repair outputs are new assets and versions.
- Automation is off by default and its cost is stated in the UI.

## Work split

The three tasks run in parallel. Codex HHTECH writes the code and default Codex reviews it.

| Task | Branch | Owns |
|---|---|---|
| P6-A domain | `wt/p6-domain` | `packages/domain/**` |
| P6-B backend | `wt/p6-backend` | `apps/desktop/src-tauri/**`, `tests/fixtures/backend/**` |
| P6-C UI | `wt/p6-ui` | `apps/desktop/src/**`, `apps/desktop/tests/**` (not fixtures) |

API §15 is the single shared contract. Integration happens on `wt/p6-integrate`.

## Acceptance

- **Local-only QC:**
  - An enhance output gets `edgeAlignment`, `sharpness` and `clippedPct`.
  - A production render of another camera gets `edgeAlignment = null`.
  - `result` follows the rules.
- **Vision QC with the mock provider:**
  - A well-formed reply produces a report.
  - Messy text around the JSON is tolerated.
  - An invalid reply gives `bad_response`.
- **Thresholds:** changing them changes the result of new runs. Old reports keep their snapshot.
- **"Sửa theo QC":** queues a `repair` generation with two references and the repair prompt, and the output links back.
- **Automation:** with `autoQc` on and `autoRepairMax` 1, a failing output gets exactly one repair and no infinite loop.
- **UI:**
  - The overlay toggles the boxes.
  - Badges show the latest result.
  - Strings exist in vi and en.
- **Checks:** `npm run verify` is green; fmt, clippy and prettier are clean.
