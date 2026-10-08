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
| P3-B domain | wt/p3-domain | Pending (Codex quota ran out mid-review) | Merged 2026-10-09 on user's provisional approval |
| P3-A backend | wt/p3-backend | Pending | Merged 2026-10-09 on user's provisional approval |
| P3-C UI | wt/p3-ui | Pending | Merged 2026-10-09 on user's provisional approval |

Phase 2 findings above: fixed in wt/p3-domain (UI #1), wt/p3-backend (backend round 2), wt/p3-ui (UI #2–4 and suggestions).
