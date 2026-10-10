# AI DNA assist — domain, backend, compiler pc-1.6.0 (ADR-030, API §20)

**Branch:** `wt/assist-core`.

**You own:**
- `packages/domain/**`
- `apps/desktop/src-tauri/**`
- `apps/desktop/src/lib/mockBackend.ts`, for the `dna_assist` mock only
- `apps/desktop/tests/fixtures/backend/**`
- the generated JSON schema files

## Read first

- ADR-013, ADR-027, ADR-028, ADR-029 and ADR-030.
- API §18, §19 and §20.
- `packages/domain/src/interior/*`, `prompt/compiler.ts`, `prompt/stylePhrases.ts`, `prompt/topology.ts`.
- `src-tauri/src/providers/hhtech/mod.rs` (config, base URL, key handling), `providers/text.rs` (sanitize), `services/generations.rs`, `commands.rs`.

## Scope

1. **Domain** (`packages/domain/src/assist/`), per §20.1. Tests:
   - `assistCatalog` covers every interior field with exact §18 ids, and the building, context and lighting fields.
   - `parseAssistReply`:
     - accepts fenced JSON
     - drops unknown paths, unknown ids, out-of-range numbers, and rooms invalid for the use, each with a reason
     - clips text
   - `applyAssistFields` is pure and the result passes `ProjectDNASchema`.
   - `containsVietnamese`.
   - The system prompt lists ids and the JSON-only rule.
2. **Backend `dna_assist`**, per §20.2.
   - Reuse the HHTECH config. Add `HHTECH_ASSIST_MODEL`, default `gemini-3.8-flash`.
   - Downscale images to a 1024 px long edge, JPEG data URL.
   - Use `json_object` response format.
   - Map errors: not configured, quota/credit, timeout, invalid reply.
   - Record a generations row with `purpose "assist"`. If the purpose enum or check constraint needs it, add a forward migration.
   - Never log the key, the image bytes or the full brief.
   - Rust tests use the local test HTTP server pattern already in `providers/*/tests.rs`. Cover:
     - the request body shape: model, messages, image parts, response_format
     - the key is absent from errors and logs
     - a credit-exhausted body ("hết credit") maps to `PROVIDER_QUOTA`
     - `master` mode without an approved master gives `INVALID_STATE`
     - at most 3 references
   - No live calls.
3. **Mock backend.** `dna_assist` returns a deterministic reply per mode and scope that exercises valid, invalid and dropped fields.
4. **Compiler pc-1.6.0**, per ADR-030.
   - **Primary + accents.** Write the test first using the real case `floor: ["oak", "terrazzo"]`. It must yield `natural oak flooring with terrazzo accents`, not `... and terrazzo flooring`.
   - **Interior camera fallback.** Reproduce the bug where `cameraPresetId "wide_entrance"` produced "close-up material and furniture detail", then fix the mapping for all 4 presets.
   - Update the snapshots deliberately. Projects without `interior` change only in the version string.
5. Regenerate the contract fixtures if they change.

## Done when

- `npm run verify` is green.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` (manifest `apps/desktop/src-tauri/Cargo.toml`) and `npx prettier --check .` are clean.
- `docs/agent-notes/assist-core.md` is written.
- Do not edit other `apps/desktop/src/**` files. If the UI breaks only because of the version or snapshots, note it.
