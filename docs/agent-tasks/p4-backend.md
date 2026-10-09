# P4-B — Backend: grade_apply (Rust grade pipeline), DNA passthrough

Branch `wt/p4-backend` (from main).

Read first:
- `tasks/PHASE_04.md`
- ADR-004, ADR-008, ADR-015, ADR-020
- `docs/API_CONTRACTS.md` §4 and §12
- `apps/desktop/src-tauri/src/`:
  - `services/generations.rs` (output writing)
  - assets
  - versions
  - `contract_fixtures.rs`

You own `apps/desktop/src-tauri/**` and `apps/desktop/tests/fixtures/backend/**`.

## Scope

1. **Rust grade pipeline** `services/grade.rs`.
   - Implement §12.3 exactly: f32 math, same step order, sRGB curves.
   - Alpha passes through.
   - Parallel rows if a crate already in the tree allows it; single-threaded is fine otherwise.
   - Target: about 2 s or less for a 4096×4096 image in a release build. Measure it and note the result.

2. **Command `grade_apply`** (§12.4).
   - Validate the request: grade ranges match the Zod schema; the asset belongs to the project and is ready.
   - Read the source and grade it **without holding the DB lock**.
   - Write the PNG and the thumbnail.
   - In one transaction, insert:
     - the asset (role `regular_image`)
     - the version: `operation = "color_grade"`, `operation_json`, `parent_version_id` = the source's latest version, label
   - Clean up the files on failure.
   - The source file and row are never modified (ADR-004).
   - Register the command and add the bridge DTO.

3. **Parity test.**
   - Read `packages/domain/test-vectors/grade.json` (path relative to the crate) and assert ±1 per 8-bit channel.
   - P4-A creates that file in parallel. Until it lands:
     - Include a small vectors file under `src-tauri/tests/`, computed from the spec.
     - Make the test prefer the domain file when it exists.
   - Say in your note that the parity test against the domain file must pass after merge.

4. **DNA.**
   - `dna_update` must accept the additive §12.1 fields: `presetId`, light `id`/`enabled`, `locks.mood`.
   - If validation is driven by the exported JSON Schema (P4-A regenerates it), nothing changes; otherwise extend it.
   - Add a round-trip test with the new fields.

5. **Contract fixtures.** Add `grade_apply`, then regenerate with `UPDATE_BACKEND_FIXTURES=1 cargo test contract_fixtures`.

## Done when

- `npm run verify` is green.
- `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` are clean.
- `docs/agent-notes/p4-backend.md` is written: timings, plus what must be rechecked after the P4-A merge.
