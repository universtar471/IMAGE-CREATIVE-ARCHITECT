# Review status

| Task | Branch | Codex review | Merge |
|---|---|---|---|
| P2-A backend | wt/p2-backend | Round 1: PHẢI SỬA → fixed. Round 2: PHẢI SỬA (contract fixture can reach real Gemini via env key) → fix in wt/p3-backend | Merged 2026-10-08 on user's provisional approval |
| P2-B Gemini | wt/p2-gemini | Round 2: ĐẠT | Merged 2026-10-08 |
| P2-C UI | wt/p2-ui | Round 1: PHẢI SỬA (4 blocking: empty-capability validation, 3 async races) → fix in wt/p3-domain / wt/p3-ui | Merged 2026-10-08 on user's provisional approval |

Pending reviews run against `main` after merge; findings are fixed in follow-up branches.

## Phase 3

| Task | Branch | Codex review | Merge |
|---|---|---|---|
| P3-B domain | wt/p3-domain | Round 1: PHẢI SỬA (production batch silently drops the anchor when maxReferenceImages is too small) → fix in wt/p3-fixes | Merged 2026-10-09 on user's provisional approval |
| P3-A backend | wt/p3-backend | Round 1: PHẢI SỬA (thread spawn failure strands a running job; cameraId not re-checked inside the insert transaction) → fix in wt/p3-fixes | Merged 2026-10-09 on user's provisional approval |
| P3-C UI | wt/p3-ui | Round 1: PHẢI SỬA (stale poll responses overwrite newer event state) → fix in wt/p3-fixes | Merged 2026-10-09 on user's provisional approval |

Phase 2 findings above: fixed in wt/p3-domain (UI #1), wt/p3-backend (backend round 2), wt/p3-ui (UI #2–4 and suggestions).

## Providers

| Task | Branch | Codex review | Merge |
| --- | --- | --- | --- |
| OpenAI provider | wt/openai-provider | Round 1: PHẢI SỬA (invented 1K/2K image-size tiers) → fix in wt/hhtech-provider (built on top) | Pending |

## Phase 4 (code by Codex via HHTECH, review by Codex default)

| Task | Branch | Codex review | Merge |
| --- | --- | --- | --- |
| P4-A domain | wt/p4-domain | Round 1: PHẢI SỬA (output-as-source role, mood presets drop lighting/weather, grade mutates input) → fix in wt/p4-integrate | Pending |
| P4-B backend | wt/p4-backend | Round 1: PHẢI SỬA (parity test path misses the domain vectors, schemaVersion defaulted) → fix in wt/p4-integrate | Pending |
| P4-C UI | wt/p4-ui | Round 1: PHẢI SỬA (no Adopt on Contact Sheet, adopt drops lighting/weather, preset select value, weather preset merge) → fix in wt/p4-integrate | Pending |
| P4 integrate | wt/p4-integrate | Round 3: ĐẠT; merged b2f528b | Merged |
| WF (4B) | wt/wf-integrate | Round 3: ĐẠT (verify green at 059757d) | Merged |
| P5 enhance | wt/p5-integrate | Round 1: P5-A ĐẠT; P5-B PHẢI SỬA (negative detailStrength); P5-C PHẢI SỬA (batch dialog/multi-select/cost, Cách dùng box, auto-select race) | Pending |
