# OpenAI image provider (GPT Image models)

Branch `wt/openai-provider`. The user wants to paste an OpenAI API key and generate with the
ChatGPT image models, next to Gemini and local_preview.

Read first:
- ADR-012/013
- `docs/API_CONTRACTS.md` §9–10
- `apps/desktop/src-tauri/src/providers/mod.rs` (trait)
- `providers/gemini/`, which is the pattern to follow
- `services/provider_settings.rs`, `secrets.rs`, `contract_fixtures.rs`
- `apps/desktop/src/lib/mockBackend.ts`
- the provider settings dialog

## Scope

1. **Verify the current API first.** Read the official OpenAI docs with WebFetch/WebSearch: the image generation guide and the Images API reference (generations + edits). Do not guess; record the URLs and the check date (today 2026-10-09) in the module doc and your note. Confirm each of these:
   - current GPT Image model ids
   - supported sizes, quality levels and `n`
   - output format and `b64_json`
   - how reference images are sent (edits endpoint, multipart `image[]`) and their max count
   - whether a mask/negative/seed exists
   - error shapes, including the `insufficient_quota`, moderation and invalid-key cases

2. **Adapter `providers/openai/`** (`mod.rs`, `models.rs`, `wire.rs`, `tests.rs`, like gemini):
   - **`info()`:** id `openai`, label "OpenAI (GPT Image)", Remote, requires a key, an honest `ModelCapabilities` per verified model:
     - `aspectRatios` mapped from the supported sizes (e.g. 1:1, 3:2, 2:3)
     - `imageSizes` only for real resolution tiers, otherwise empty (a null value is then required)
     - `maxOutputs` ≤ 4
     - `supportsNegativePrompt` / `supportsSeed` false unless the docs say otherwise
   - **Which endpoint:**
     - no references → `POST /v1/images/generations` (JSON)
     - with references → `POST /v1/images/edits` (multipart, references in request order)
     - reqwest `multipart` feature allowed
     - Bearer auth
   - **Prompt composition:** a pure function, unit tested. Build one text: positive + reference instructions + preservation + "Avoid: …", plus a numbered description of each reference image's role in order.
   - **Error mapping to `ProviderErrorKind`:**

     | Response | Kind | Message / retry |
     |---|---|---|
     | 401 | Auth | |
     | 429 `rate_limit_exceeded` | RateLimited | retryable |
     | 429 `insufficient_quota` / billing | Auth (or InvalidRequest) | NOT retryable; message tells the user to add billing / credits |
     | moderation / `content_policy_violation` | Blocked | |
     | other 400 | InvalidRequest | |
     | 5xx / connect | Network | |
     | timeout | Timeout | |
     | 200 without image | BadResponse | |

     The key is redacted from every message/meta path.
   - **Timeouts:** about 300 s for generate (GPT Image can be slow), 15 s for `test_connection`.
   - **`test_connection`:** a cheap authenticated GET (e.g. `/v1/models/{model}`) that validates the JSON shape.
   - **Tests:** a local mock HTTP server, no network. Reuse the Gemini mock server by moving it into a shared test-only helper (e.g. `providers/test_http.rs`) rather than copying it. Add one `#[ignore]` live smoke test that reads `ARCH_STUDIO_OPENAI_API_KEY` and costs one image.

3. **Quota-vs-rate lesson for Gemini too.** A real run showed Gemini returning 429 for an exhausted / free-tier image quota and the queue retrying it 3 times. If Gemini's 429 body says the quota is exhausted (`RESOURCE_EXHAUSTED` with a quota-violation or free-tier detail), map it as non-retryable with an actionable billing message. A plain rate limit stays retryable. Test both.

4. **Registry and fixtures:**
   - Register in `ProviderRegistry::builtin()` in the order gemini, openai, local_preview.
   - Contract fixtures: point openai at an unroutable base URL like gemini, and regenerate them.
   - Secrets: the env fallback `ARCH_STUDIO_OPENAI_API_KEY` works automatically; verify it.

5. **UI:**
   - The mock backend gets the same openai provider and models.
   - Remove any Gemini-only wording or help links from the provider dialog or Generate panel. Per-provider help: where to get a key (platform.openai.com/api-keys) and the billing note.
   - The provider list is data-driven; check nothing else is hardcoded.

6. **README:** the provider section gains OpenAI, the env var and the live smoke command.

## Done when

- `npm run verify` is green.
- `cargo fmt --check` and `npx prettier --check .` are clean.
- `docs/agent-notes/openai-provider.md` covers the verified models + limits with links, what could not be verified, and how to run the live test.
- Small commits on `wt/openai-provider`.
