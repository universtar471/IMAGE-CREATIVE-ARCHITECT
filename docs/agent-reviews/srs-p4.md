# Review: wt/srs-p4 (ADR-037)

**Verdict: ĐẠT. Merged.**

Codex (Volibear) started this work and stopped when its credit ran out. A Claude subagent finished it and fixed these bugs in the Codex work:
- the "illustrative" label was lost when a step was edited;
- steps repeated themselves;
- annotation coordinates fell outside 0..1;
- there was no interior evidence rule (AC-14).

A separate subagent resolved the 11-file merge with P5b and debts-1, keeping both sides. In `API_CONTRACTS`, Publishing stays §22 and Diagram is now §23.

## Lead verification (after the merge)

- Vitest: 83 files, 1012 tests pass.
- Typecheck and prettier: clean.
- Subagent run: Rust 324 tests pass, clippy clean.

## NÊN SỬA (later)

- **Real-app export:** PNG 4K and MP4 have not been exported from the real Tauri app. Someone needs to check text sharpness and Vietnamese diacritics there.
- **Persistence:** diagram plans live only in the session. Persisting them needs a table, in migration 0010.
- **Approval gate:** PNG export also requires every step to be approved, which is stricter than the brief. This is easy to relax.
- **Interior evidence rule:** it is coarse. Any confirmed space fact counts.
