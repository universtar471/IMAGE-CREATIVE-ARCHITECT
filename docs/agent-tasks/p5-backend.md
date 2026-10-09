# P5-B — Backend: local_upscale provider, enhance purpose, exact resize (ADR-023, API §14)

Branch `wt/p5-backend`. You own `apps/desktop/src-tauri/**` and `apps/desktop/tests/fixtures/backend/**`.

Read first:
- `tasks/PHASE_05.md`, ADR-023, API §14
- ADR-017/018/022
- `providers/` (`mod.rs`, `local_preview`, `openai`, `hhtech`, `gemini`)
- `services/generations.rs` (validate, run_job, store_outputs, commit_outputs)
- `services/batches.rs`, `services/workflow.rs`, `services/grade.rs` (as the pattern for writing a new asset + version)
- `imaging.rs`, `contract_fixtures.rs`

## Scope

1. **Provider `local_upscale`** (`providers/local_upscale.rs`)
   - Implements `ImageProvider` with the §14.2 capabilities. Local lane, no key.
   - Lanczos3 resize to the target long edge, then the unsharp mask with the §14.2 numbers.
   - Uses only the `image` crate already in the tree.
   - Register it in the provider registry.
   - Tests:
     - exact output size and aspect
     - sharpen amount 0 equals a pure resize
     - alpha is kept

2. **Purpose `enhance`** in `parse_purpose`, validation and the DTOs.
   - Validate per §14.1:
     - exactly one ready reference that belongs to the project
     - `params.enhance` is present
     - `conservative` uses `local_upscale` and has a target
     - no downsizing (compare with the source long edge read from the file or its stored dimensions)
     - the effective long edge is at most 8192
     - `generative` needs a model with references
   - Each failure gives a clear `validation_error`.

3. **Generative path**
   - Send the source as the only reference plus the prompt from the request: compiled by the UI with the domain `buildEnhancePrompt`, stored in the request like other purposes.
   - For HHTECH when the user leaves the model on its default: pick the Gemini 3 Pro Image tier per ADR-023:
     - 4K when the target is above 2048
     - otherwise 2K
   - The tier mapping lives in `providers/hhtech/catalog.rs`.

4. **Exact resize**
   - When storing the outputs of an `enhance` generation, resize every output to exactly `targetLongEdge` with Lanczos3 when it is set.
   - Write meta `sourceLongEdge`, `providerLongEdge`, `finalLongEdge`.
   - Version `operation = "enhance"`, with `operation_json` per §14.3.
   - Role `regular_image`.
   - Do the resize outside the DB lock.

5. **Gating**
   - `enhance` needs an approved master (extend the §13.4 check).

6. **Batches**
   - `batch_create` with enhance items works, with one job per item.
   - Conservative jobs run on the local lane.

7. **Contract fixtures**
   - Add enhance submit / DTO examples, then regenerate with `UPDATE_BACKEND_FIXTURES=1 cargo test contract_fixtures`.

8. **Tests**
   - conservative end to end through the queue with the test DB: source bytes unchanged, exact size, version lineage
   - generative with the mock HTTP provider: one reference sent, then resized to the target
   - every validation error
   - gating
   - Add one `#[ignore]` live smoke test `hhtech_live_enhance` that reads `.env` like the other live tests.

## Done when

- `npm run verify` is green.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `npx prettier --check .` are clean.
- `docs/agent-notes/p5-backend.md` is written, including timings for a conservative 2048→4096 run in a release build if feasible.
