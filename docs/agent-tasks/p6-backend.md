# P6-B — Backend: local QC metrics, vision judge, qc commands, repair purpose, automation

Branch `wt/p6-backend`. You own `apps/desktop/src-tauri/**` and `apps/desktop/tests/fixtures/backend/**`.

Read first:
- `tasks/PHASE_06.md`, ADR-024, API §15
- ADR-017/022/023
- `providers/` (`openai` chat_completion, `hhtech`, `mod.rs` chat trait, `test_http.rs`)
- `services/generations.rs` (`validate`, `commit_outputs`), `services/workflow.rs`, `services/grade.rs`
- `services/enhance` code paths (for reading images without the DB lock)
- `imaging.rs`, `migrations/`, `contract_fixtures.rs`, `docs/DATA_MODEL.md` (`qc_reports`)

## Scope

1. **Migration `0005_qc.sql`** per §15.4. Add a migration test.
2. **Local metrics** in `services/qc/local.rs` (or similar), exactly per ADR-024:
   - Sobel edges at a 512 px long edge.
   - The reference is resized to the output's 512 px size.
   - Edges use a threshold; document the chosen value in code.
   - 2 px dilation, then IoU.
   - Sharpness: variance of the Laplacian, then `min(100, var/4)`.
   - `clippedPct`.
   - `edgeAlignment = null` unless the purpose is in the same-view set or the asset is a `color_grade` output.
   - Unit tests with synthetic images:
     - identical → about 100
     - shifted
     - blank → low sharpness
     - clipped percentage
3. **Vision judge**
   - Add `fn vision(&self, system, user, images: &[(mime, bytes)], model: Option<&str>, api_key) -> Result<String, ProviderError>` to the provider trait, with a default "not supported".
   - Implement it for the OpenAI adapter (official and gateway): chat completions with content parts `[{type:"text"}, {type:"image_url", image_url:{url:"data:image/jpeg;base64,…"}}]`.
   - Images are JPEG q85 at a 1024 px long edge.
   - HHTECH model: `HHTECH_VISION_MODEL`, falling back to `HHTECH_CHAT_MODEL`.
   - Timeout 120 s. Errors are mapped like chat; keys are redacted.
   - Capabilities gain `vision: bool` (true for hhtech/openai when a chat model exists, false otherwise). Add it to the DTO and the fixtures.
   - Parse the reply with the same lenient rules as the domain `parseVisionReply`: first balanced JSON object, validate, clamp. Mirror the domain tests.
   - Mock-HTTP tests: content parts shape, data URL, error mapping, a messy reply, an invalid reply → `bad_response`.
   - Add an `#[ignore]` `hhtech_live_vision` test.
4. **Commands** `qc_run`, `qc_list`, `qc_settings_get`, `qc_settings_set` per §15.2.
   - Scoring mirrors the domain `scoreReport`. Snapshot the thresholds into the report.
   - No DB lock during image work or network calls.
   - Register the commands; add DTOs.
5. **Repair purpose** (§15.3).
   - Validation: the report exists in the project, references = [report asset, report primary reference], gating like `variation`.
   - Meta records `repairOf` and `repairDepth`, where depth = the parent's depth + 1.
   - The prompt comes from the request, like the other purposes.
6. **Automation** (§15.5), after `commit_outputs`.
   - Sequential per project on a background thread.
   - Never fails or blocks the original generation.
   - At most `autoRepairMax` repairs along a chain.
   - The repair prompt is built in Rust with a mirror of `buildRepairPrompt`; keep the text identical and add a shared snapshot fixture so both sides are compared.
   - Tests use the queue test harness and a mock vision provider: one repair at max 1, none at max 0, no loop.
7. **Contract fixtures.** Add the new commands and the `vision` capability, then regenerate with `UPDATE_BACKEND_FIXTURES=1 cargo test contract_fixtures`.

## Done when

- `npm run verify` is green, or only blocked by UI/domain integration items, listed in the note.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `npx prettier --check .` are clean.
- `docs/agent-notes/p6-backend.md` is written.
