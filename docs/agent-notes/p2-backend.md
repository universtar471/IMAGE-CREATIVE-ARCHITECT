# wt/p2-backend — P2-A backend core

- Agent: claude
- Branched from: main (3ead73d, Phase 2 contracts)
- Brief: `docs/agent-tasks/p2-backend.md`

## Goal

Secrets, the offline `local_preview` provider, the generation service (ADR-014/015), the
provider/generation DTOs and seven Tauri commands. The Gemini adapter (P2-B) and the UI
(P2-C) are not in this branch.

## Done

- `src/secrets.rs`
  - `SecretStore` trait, with `KeyringSecretStore` (service `com.archaistudio.desktop.provider`,
    account = provider id) and `MemorySecretStore`.
  - `resolve_key`: keychain first, then `ARCH_STUDIO_<ID>_API_KEY`, and reports `KeySource`.
  - `clean_key`: trims, then rejects an empty key, a key over 512 chars or one with inner whitespace.
  - `ResolvedKey`'s `Debug` output redacts the key.
- `AppCore`
  - Gains `providers` and `secrets`.
  - `open()` wires the builtin providers and the keychain. `open_with()` is for tests.
  - On open, `running` rows become `interrupted` (kind `interrupted`, retryable true, `finishedAt` null).
- `providers/local_preview.rs`
  - Deterministic PNGs from a SHA-256 of positive + negative prompt, seed and output index.
  - Long edge 1024. The aspect ratio comes from params (default 4:3).
  - The first reference is downscaled and blended in at 60 %.
- `services/assets.rs`: `store_managed_image` + `StoredImage::remove_files`. Import and generation share them, so the `.part` + rename logic exists once.
- `services/provider_settings.rs`: list, set/clear key, and test (a failure returns `ok:false`). Descriptors never carry the key.
- `services/generations.rs`: `submit`, `list` (newest first), `get` and `recover_interrupted`.
- Versions
  - `VersionRow` / `VersionDto` gain `generation_id` (JSON `generationId`, null for imports).
  - Generated versions point at the parent asset's latest version.
- Commands registered in `lib.rs`: `provider_list` (no request args), `provider_set_api_key`,
  `provider_clear_api_key`, `provider_test`, `generation_submit`, `generation_list`, `generation_get`.
- Tests: `services::tests_support` has `core()`, `core_with_double()`, `open_test_core(root)` and
  `TestProvider` (provider `test_remote`; models `full`, `text-only` and `edit-only`). `TestProvider`
  supports behaviours, records the request it received, and can run a hook during the call.

## Decisions (contract kept unchanged)

1. **Reference bytes are read before the `running` row is inserted, not after.** This keeps
   "missing reference file → `INVALID_STATE`, no row" true. The DB lock is still released
   before the file reads and before the provider call.
2. **`aspectRatio` / `imageSize` must be null when the model lists none.** This is the
   API_CONTRACTS §9 rule (clarified on main in 8a06735). A non-null value then gives
   `VALIDATION_ERROR`. Covered by `empty_capability_lists_require_null_values`.
3. **Extra `error.kind` values beyond the Zod comment list:**
   - `io`: a local file or DB failure while saving outputs (retryable true). Written files are
     removed.
   - `interrupted` is also used, with retryable **false**, when the project is archived during
     the call. Outputs are discarded and no assets are created.
   - `kind` is `z.string()`, so parsing still succeeds. The UI should show unknown kinds generically.
4. **Unreadable or empty provider output:**
   - Non-image bytes or zero images → `bad_response` (retryable true).
   - More images than `outputCount` → only the first `outputCount` are kept.
5. **Purpose:** an unknown `purpose` string → `VALIDATION_ERROR`. The command takes a string,
   like the role/source fields in import.
6. **References from another project → `NOT_FOUND`.** The asset is "unknown in this project",
   which differs from Phase 1's `asset_set_master`, which returns `VALIDATION_ERROR`.
7. **A keychain read error is logged (without the key) and treated as "no keychain key".** The
   provider list and the env fallback still work on machines without a credential store.
   Set/clear errors are returned as `IO_ERROR`.
8. **The parent asset may be removed during the call.** The outputs then get
   `parent_asset_id = null` and no parent version; otherwise the FK would reject the insert.
9. **Names:**
   - Asset `original_name` and version label: `"<Hero|Variation> <n> — <model label>"`, with n counting from 1.
   - `operation_json`: `{generationId, providerId, modelId, outputIndex}`, where `outputIndex` counts from 0.

## What the UI (P2-C) must know about the JSON

- All shapes match `generation.ts` exactly. Tests assert the full key sets of
  `ProviderDescriptorDTO`, `ModelCapabilities`, `GenerationDTO`, `params`, `prompt` and `error`.
- `kind` is `"local" | "remote"`. `keySource` is `"keychain" | "env" | null`. It is null for
  providers that need no key.
- `GenerationDTO.error` is `null` for completed generations. `finishedAt` / `durationMs` are
  null for `interrupted` rows.
- `outputAssetIds` shrinks when an output asset is removed; the generation stays.
- `PROVIDER_NOT_CONFIGURED` details: `{ providerId }`. A missing reference file gives
  `INVALID_STATE` with details `{ assetId }`.
- `provider_list` takes no request fields (the bridge's `{ request: {} }` is ignored).
- Send `aspectRatio` / `imageSize` as null when the model's list is empty (§9, decision 2).

## Open debts

- No cancellation, retries or job queue (Phase 3, by design).
- `local_preview` ignores `imageSize` (it only offers "1K").
- After a crash, files written just before the DB commit could be orphaned in `assets/original`.
  No sweeper exists yet.

## Test commands

```
cd apps/desktop/src-tauri
cargo test                                   # 66 tests
cargo clippy --all-targets -- -D warnings
cargo fmt --check
cd ../../.. && npm install && npm run verify # green (vitest 70 + cargo)
```

## Traps

- Python `open(..., 'w')` on Windows writes CRLF. Use `newline=''`. The repo is `eol=lf`.
- A Bash heredoc in the agent tool failed on some Rust snippets that contain `'` and `\\`. Writing
  the files with the Write tool works.
- The tests never touch the OS keychain: `tests_support` always uses `MemorySecretStore`. The env
  fallback test uses a provider id unique to that test, so parallel tests do not race on the variable.
- Do not edit `providers/gemini.rs` here. P2-B turns it into `providers/gemini/`. Expect a trivial
  merge only in `providers/mod.rs` if P2-B changed it.

## Review round 1 (Codex, `main:docs/agent-reviews/p2-backend.md`)

Failing tests were written first, then fixed.

- **MUST 1: undecodable output.**
  - Every generated output is now fully decoded (`imaging::decode`) before anything is written.
    A PNG with a valid header but corrupt IDAT data → `failed` / `bad_response`.
  - The thumbnail is written from the decoded image (`Thumbnail::Required`). A failure there is
    `io`, and every file of the batch is cleaned up.
  - Import keeps its best-effort thumbnail policy (`Thumbnail::BestEffort`).
  - Tests:
    - `header_valid_png_with_corrupt_pixels_is_bad_response` (the fixture is checked to pass
      `inspect`)
    - `thumbnail_write_failure_fails_the_whole_batch_as_io`
    - `required_thumbnail_failure_removes_the_written_original`
- **MUST 2: no code change.**
  - The contract on main now says a value must be null when the model's list is empty. The
    behaviour already matched.
  - This note no longer calls it a deviation. A dedicated test was added.
- **MUST 3: references re-checked under the insert lock.**
  - `check_reference` (exists, same project, `ready`, managed file present) runs at validation.
    It runs again in the same lock scope as `insert_generation`.
  - A reference removed in between → `NOT_FOUND`; a lost file → `INVALID_STATE`. In both cases
    no row is created and nothing is sent.
  - Tests: `reference_removed_before_insert_is_rejected_without_a_row` (master and non-master)
    and `reference_file_lost_before_insert_is_invalid_state`.
- **SHOULD: rollback.**
  - `sql_failure_on_second_output_rolls_back_everything` uses a SQLite trigger that aborts the
    second `generation_outputs` insert.
  - `original_write_failure_mid_batch_rolls_back_everything`.
  - Both assert that the generation is `failed` / `io`, that assets, versions and
    generation_outputs are empty, and that no originals or previews are left.
- **SHOULD: cleanup failures.**
  - `StoredImage::remove_files` now logs undeletable files (asset id + path only, no provider
    data) and returns them.
  - A file that is already missing is not a failure. The primary error is unchanged.
  - Test: `cleanup_failures_are_reported_with_asset_id_and_path`.
- **Test seams (`#[cfg(test)]` only, thread-local so parallel tests do not interfere):**
  - `assets::faults::{FAIL_ORIGINAL_AT, FAIL_THUMBNAIL_AT}`.
  - `generations::AFTER_PREPARE`, a hook between validation and the insert.

## Review round 1 follow-up

- **Monotonic IDs.**
  - Found by the integration fixture test: outputs of one generation and their versions share
    one `created_at`, and the lists order by `created_at, id`.
  - `Ulid::generate()` is random within a millisecond. So Hero 1 and Hero 2 could swap places
    between runs, and the "latest version of the parent" lookup was ambiguous for versions
    created in the same millisecond.
  - Fix: `util::new_id` now uses `ulid::Generator` behind a process-wide `Mutex`. IDs are
    strictly increasing, across threads too.
  - Overflow uses `commit_overflow_increment`, which borrows from the next millisecond and
    keeps the order. A poisoned lock is recovered, because the generator state stays valid.
  - Tests:
    - `ids_created_later_always_sort_after_earlier_ones` (20 000 IDs in a tight loop)
    - `ids_stay_increasing_across_threads`
    - `three_outputs_list_in_output_order` (assets and versions follow output order, run 5×)
- **Upgrade from a Phase 1 database.**
  - `upgrades_a_phase_1_database_to_v2_and_can_generate_from_its_master` builds a v1-only
    database (project with an approved master, DNA, two assets, versions, managed files), then
    opens it with the current app.
  - It checks:
    - the schema is v2, FKs are on and `foreign_key_check` is clean
    - all old rows are intact and `versions.generation_id` is NULL
    - a `local_preview` submit with the old master completes, with
      `parent_version_id` = the master's old version
