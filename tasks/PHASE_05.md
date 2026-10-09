# Phase 5 — Enhancement / 2K / 4K (ADR-023, API §14)

ROADMAP Phase 5. Planned by the lead overnight. The user asked to continue to the next phase after Phase 4B without waiting; they will check in the morning.

## Goal

**Hậu kỳ › Nâng cấp** turns a finished image into a sharper, larger one without changing the architecture:

- **Conservative upscale:** local, free, deterministic. Lanczos3 plus a mild sharpen.
- **Generative detail:** an edit through HHTECH / OpenAI / Gemini with an Architecture Preserve prompt, then an exact resize to the requested long edge.
- **Detail strength:** 0–100.
- **Long-edge sizing:** 2048 / 3072 / 4096.
- **Batch enhancement:** over several selected images.
- **Before/after:** a compare view (before / after / split).

## Constraints

- **No live paid calls in tests.** Providers are tested with the existing mock HTTP server; live smoke tests stay `#[ignore]`.
- **Source never modified (ADR-004).** Every output is a new asset and version, `operation = "enhance"`.
- **Gating (ADR-022):** `enhance` needs an approved master.

## Work split (parallel; coding by Codex HHTECH, review by default Codex)

| Task | Branch | Owns |
|---|---|---|
| P5-A domain | `wt/p5-domain` | `packages/domain/**` |
| P5-B backend | `wt/p5-backend` | `apps/desktop/src-tauri/**`, `tests/fixtures/backend/**` |
| P5-C UI | `wt/p5-ui` | `apps/desktop/src/**`, `apps/desktop/tests/**` (not fixtures) |

API §14 is the single shared contract. Integration happens on `wt/p5-integrate`.

## Acceptance

- **Conservative 2048 → 4096:** produces exactly a 4096 long edge with the same aspect. The source bytes are unchanged and the version lineage is correct.
- **Generative run:** with the mock provider, sends one reference plus the preserve prompt, then resizes to the target.
- **Validation:** a downsizing target is rejected, and so is an effective long edge above 8192.
- **Batch:** enhancing 3 selected images creates 3 jobs in one batch, and results appear grouped.
- **Compare view:** works for any enhance output against its source.
- **Strings and checks:**
  - vi and en strings are present.
  - `npm run verify` is green; fmt, clippy and prettier are clean.
