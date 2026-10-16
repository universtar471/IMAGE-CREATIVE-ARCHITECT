# SRS debts 1 — gate, snapshot and batch follow-ups (ADR-034, ADR-036)

**Branch:** `wt/srs-debts-1`. These items were collected from the "NÊN SỬA" sections of `docs/agent-reviews/srs-p0.md`, `srs-p2b.md` and `srs-p2d.md`.

## Scope

1. **Retry re-validates.** `job_retry` and the desktop retry paths re-run `validateShot` against the *current* DNA before they resend a stored snapshot.
   - A shot that would now be blocked (BLOCK) is refused with `VALIDATION_ERROR`.
   - A warning (WARN) that was not accepted before asks again.
   - Find every retry path: the jobs panel, failed batch items, and the enhance batch "retry failed".
2. **Exception panel everywhere.** These surfaces currently skip WARN items with only a toast:
   - ContactSheet re-run batch
   - Mood variations
   - Enhance batch (generative)

   Each of them must offer the same "Duyệt ngoại lệ" approval that the generate and batch dialogs use. Reuse `features/validation/ConflictPanel.tsx` and `gate.ts`.
3. **`resolvedWarnings` means accepted.** The compiler currently pre-fills `resolvedWarnings` with every WARN code it finds in the DNA.
   - Change it so the field holds only the WARN codes the user accepted, as set by the gate through `withValidation`.
   - Keep the found codes available in `validation.issueCodes`.
   - Update the provenance tests. The AC-21 byte-identity test still passes.
4. **Per-item detail target in planned batches.** "Khám phá chi tiết" currently sends one shared ShotIntent for the whole batch.
   - Each batch item gets its own ShotIntent with its own `targetDetailId`, stored in each item's prompt snapshot.
   - The gate validates each item with its own intent.
5. **ShotIntent survives restart.** The per-project ShotIntent is lost when the app restarts. Persist it per project.
   - Use an existing project UI-state store if one exists; otherwise use `localStorage`, wrapped in try/catch, keyed by project id.
   - Never write it into the DNA.
   - On load, validate the stored value with `ShotIntentSchema` and drop it if it is invalid.

## Tests

Add a test for each item:
- A retry of a now-blocked snapshot is refused.
- The exception panel works on each of the three surfaces.
- `resolvedWarnings` contains only accepted codes.
- Batch items carry distinct `targetDetailId` values.
- The ShotIntent survives a store re-init, and corrupt stored data is ignored.

## Out of scope

- `packages/domain/src/{diagram,publishing}/**`, `features/{diagram,publishing}/**`: other branches own these.
- Space wizard, site editor and camera intent UX: those are debts-2.

## Done when

- `npm run verify` and `npx prettier --check .` pass.
- In `apps/desktop/src-tauri`, these pass:
  - `cargo fmt --check`
  - `cargo clippy --offline --all-targets -- -D warnings`
  - `cargo test --offline`
- `docs/agent-notes/srs-debts-1.md` is written.
- Nothing is committed. `.env` is not touched.
