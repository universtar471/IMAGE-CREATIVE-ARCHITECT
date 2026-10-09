# HHTECH provider (OpenAI-compatible gateway) + prompt enhancement

Branch `wt/hhtech-provider`, based on `wt/openai-provider` (OpenAI GPT Image adapter in
`apps/desktop/src-tauri/src/providers/openai/`). The user has an HHTECH key: an OpenAI-compatible
gateway that serves image models and chat models under one base URL.

Read first: ADR-012/013, `docs/API_CONTRACTS.md` §9–10, `providers/openai/` (reuse it),
`providers/mod.rs`, `secrets.rs`, `services/provider_settings.rs`, `contract_fixtures.rs`,
`apps/desktop/src/lib/mockBackend.ts`, `docs/agent-notes/openai-provider.md`.

## Config (never in source, never in SQLite/logs/DTOs/webview — ADR-013)

| Var | Default | Meaning |
|---|---|---|
| `HHTECH_API_KEY` | — | Bearer key. Keychain (provider id `hhtech`) wins; then `HHTECH_API_KEY`; then `ARCH_STUDIO_HHTECH_API_KEY`. |
| `HHTECH_BASE_URL` | — | e.g. `https://…/v1`. Required; provider shows "not configured" with a clear hint if missing. Trim trailing `/`. Must be https (allow http only for 127.0.0.1/localhost, for tests). |
| `HHTECH_IMAGE_MODEL` | `gpt-image-2` | comma-separated list allowed → several models in the picker |
| `HHTECH_IMAGE_SIZE` | `1024x1024` | default size |
| `HHTECH_IMAGE_QUALITY` | `medium` | |
| `HHTECH_CHAT_MODEL` | `claude-sonnet-5` | used by prompt enhancement |

`.env` loading: at app startup load `.env` from the current working directory and from the
repo root when running in dev (use the `dotenvy` crate; never override variables already set;
never log values). `.env` is already gitignored; add `.env.example` (committed) listing the
variables with empty values. Base URL is not secret but still only from env.

## 1. Image provider `hhtech`

- Reuse the OpenAI adapter: refactor it to take a config (id, label, base URL, models, defaults)
  instead of duplicating code. `openai` stays as-is (base `https://api.openai.com/v1`).
- Label "HHTECH (OpenAI-compatible)", Remote, requires key.
- No references → `POST {BASE}/images/generations` JSON
  `{model, prompt, size, quality, n, response_format:"b64_json"}`.
- References → `POST {BASE}/images/edits` multipart: `model, prompt, image (file; image[] if more
  than one — test both field names are handled per OpenAI adapter conventions), size, quality,
  response_format`.
- Response: `data[i].b64_json` → decode → PNG. If only `data[i].url` comes back, download it
  (https only, size cap, same timeout) and store it. Neither → BadResponse.
- Gateways may differ from OpenAI: be lenient (accept missing `response_format` support by
  falling back to url), and map errors from both OpenAI-style `{error:{message,type,code}}`
  and plain-text bodies. Error messages must print the HTTP status + gateway message clearly,
  key redacted.
- `test_connection`: `GET {BASE}/models` (validate JSON); if 404, fall back to a successful
  auth check message explaining the gateway has no /models.
- Capabilities: honest; sizes from config; `maxOutputs` ≤ 4; seed/negative false.

## 2. Prompt enhancement (chat)

- Backend command `prompt_enhance { projectId, providerId: "hhtech", text, context }` →
  `{ text }`. `POST {BASE}/chat/completions` `{model: HHTECH_CHAT_MODEL, messages:[system,
  user]}`; read `choices[0].message.content`. Timeout 60 s. Errors mapped like images.
- System prompt: rewrite the user's architectural image prompt to be more specific
  (materials, light, camera, atmosphere) while preserving every fact from the Project DNA
  context; no invented dimensions; return only the prompt text.
- Domain/bridge: add the request/response Zod schemas and the command to
  `docs/API_CONTRACTS.md` (new subsection) and the contract fixtures (point at an unroutable
  base URL like the others; fixtures never touch the network).
- UI: in the Generate panel, an "Enhance prompt" button next to the user's free-text/extra
  prompt input (the editable part, not the compiled DNA sections). Shows a spinner, then
  a preview with Accept / Discard; Accept replaces the field (undo-able). Disabled with a
  tooltip when HHTECH is not configured. Mock backend implements it deterministically.

## 3. Test commands

- Rust unit tests with the shared mock HTTP server (`providers/test_http.rs`) for:
  generations, edits (multipart field check), url fallback, error mapping, chat.
- Three `#[ignore]` live smoke tests, each printing the gateway error body clearly on failure:
  `hhtech_live_chat`, `hhtech_live_generate` (1024x1024), `hhtech_live_edit` (uses a small
  generated PNG as reference). They read `.env` via dotenvy. Document in README:
  `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml hhtech_live -- --ignored --nocapture`.
  Live tests save output PNGs to a temp dir and print the path.

## Done when

- `npm run verify` green; `cargo fmt --check` and `npx prettier --check .` clean.
- README provider section gains HHTECH + `.env` instructions.
- `docs/agent-notes/hhtech-provider.md` written (what was verified, gateway assumptions,
  how to run the live tests).
- Small commits.
