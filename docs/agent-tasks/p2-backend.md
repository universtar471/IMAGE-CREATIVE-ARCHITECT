# P2-A — Backend core: secrets, local provider, generation service, commands

Branch `wt/p2-backend`. Read first: `tasks/PHASE_02.md`, ADR-012…015, `docs/API_CONTRACTS.md` §9,
`packages/domain/src/schemas/generation.ts`, `src-tauri/src/providers/mod.rs`.
You own `apps/desktop/src-tauri/src/**` except `providers/gemini.rs` (task P2-B).
Do not touch the frontend or `packages/domain`.

## Scope

1. **`src/secrets.rs`**
   - `trait SecretStore: Send + Sync { get / set / delete }` keyed by provider id.
   - `KeyringSecretStore` (`keyring` 3, service `com.archaistudio.desktop.provider`,
     account = provider id); `MemorySecretStore` for tests.
   - Key lookup: keychain first, then env `ARCH_STUDIO_<ID_UPPERCASE>_API_KEY`; report
     `keySource` `"keychain" | "env"`.
   - `set` trims; rejects empty, >512 chars or inner whitespace (`VALIDATION_ERROR`).
   - Keys never appear in logs, errors or DTOs.
   - Tests must never touch the real OS keychain.

2. **`AppCore`**
   - Add `providers: ProviderRegistry` and `secrets: Arc<dyn SecretStore>`.
   - `AppCore::open(data_root)` keeps working (builtin registry + keyring store).
   - Add an `open_with(...)` for tests; `tests_support` uses the memory store plus a test-double provider.
   - On open, mark generations still `running` as `interrupted` (error kind `interrupted`, retryable true).

3. **`providers/local_preview.rs`**: implement `generate`.
   - Deterministic PNG(s): same request ⇒ same bytes.
   - Long edge 1024 px, aspect ratio from params (default 4:3).
   - Content derived from a hash of the prompt + seed + output index.
   - If references exist, blend a downscaled first reference so image-to-image is visible.
   - Returns `outputCount` images.

4. **`services/generations.rs`**: `submit`, `list`, `get`, `recover_interrupted`. Follow ADR-014/015 exactly.
   - **Validation:** the whole list in API_CONTRACTS §9, before any row is written.
   - **Persist + call:**
     - Insert a `running` row with the request snapshot JSON (prompt bundle, ordered `referenceAssetIds`, params).
     - Release the DB mutex.
     - Read reference bytes from managed storage, then call the provider. **No DB lock is held during the provider call.**
   - **Store each output:**
     - Run `imaging::inspect` (reject non-image output as `bad_response`).
     - Write the managed original + thumbnail. Factor a shared helper out of `services/assets.rs` import; do not duplicate the `.part` + rename logic.
     - Then one transaction inserts:
       - the assets: `source ai_generated`, `role regular_image`, `operation generate`, `operation_json {generationId, providerId, modelId, outputIndex}`, `original_name` like `"Hero 1 — <model label>"`
       - the versions: `parent_version_id` = parent asset's latest version, `generation_id`, label
       - the `generation_outputs` rows
       - the row update to `completed`, with `finished_at` / `duration_ms`
     - No duplicate-SHA rejection for generated outputs.
   - **Failure handling:**
     - A provider error → row `failed` with kind/message/retryable, returned as DTO.
     - A DB or file failure after the call → remove written files, mark the row `failed` (`bad_response` or `io`, your call, document it).
     - Project archived during the call → `failed`, no assets.

5. **DTOs and commands**
   - Rust DTOs matching `generation.ts` exactly. `VersionDto` gains `generation_id`.
   - Commands (thin, `spawn_blocking` via the existing `blocking` helper), registered in `lib.rs`:
     - `provider_list`, `provider_set_api_key`, `provider_clear_api_key`, `provider_test`
     - `generation_submit`, `generation_list`, `generation_get`
   - `provider_test` maps `Err` to `{ ok: false, message }`.

6. **Tests** (cargo, no network). At minimum:
   - local_preview is deterministic, with correct dims and count
   - submit happy path creates assets + versions + outputs + lineage
   - each validation rule
   - missing key → `PROVIDER_NOT_CONFIGURED` and no row
   - provider error → `failed` row, no assets
   - outputs survive reopen
   - running → interrupted on reopen
   - removing an output asset keeps the generation (outputs list shrinks)
   - key never in `request_json`
   - archived project rejected
   - DTO JSON keys are camelCase and match the Zod field names (serialize one DTO and assert the key set)

## Done when

- `cargo test` and `cargo clippy --all-targets -- -D warnings` pass from `apps/desktop/src-tauri`.
- `cargo fmt --check` is clean.
- `npm run verify` from the repo root is green.
- `docs/agent-notes/p2-backend.md` is written: what was done, deviations, traps, test commands.
- Small commits on `wt/p2-backend`, with commit messages that say what changed and why.

Do not implement the Gemini adapter, any UI, a job queue, retries or cancellation.
