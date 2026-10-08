# P2-B — Gemini image adapter

Branch `wt/p2-gemini`. Read first: `tasks/PHASE_02.md`, ADR-012/013, `src-tauri/src/providers/mod.rs`.
You own only `apps/desktop/src-tauri/src/providers/gemini.rs` (split into `providers/gemini/` if it
grows) plus `[dev-dependencies]` in `Cargo.toml` if you need a mock HTTP server.
Runtime deps `reqwest` (blocking, json, rustls) and `base64` are already present. Do not touch
services, commands, the registry or the frontend.

## Scope

1. **Verify the current API first.** Read the official docs
   (https://ai.google.dev/gemini-api/docs/image-generation and the `generateContent` reference)
   and confirm:
   - the model ids
   - the image config fields (aspect ratio, image size)
   - the reference-image limits

   Do not guess. Put the doc URLs and the date you checked in the module doc comment.
   Expected starting point (verify each item):
   - `gemini-2.5-flash-image`
   - a newer pro image model if the docs list one, with `imageSize` `1K`/`2K`/`4K`
   - `POST {base}/models/{model}:generateContent`, header `x-goog-api-key`
   - `generationConfig.responseModalities` including `IMAGE`
   - `generationConfig.imageConfig.aspectRatio`
   - response `candidates[].content.parts[].inlineData { mimeType, data }`

2. **`info()`**
   - Fill an honest `ModelCapabilities` per model from the docs.
   - If a model returns one image per call, set `max_outputs` to 4 and make `outputCount` sequential calls.
   - On partial failure, return the images that succeeded and put the failure count in `meta`. If none succeeded, return the error.

3. **Prompt composition: a pure function, unit tested.** Gemini has no negative prompt, so build one text from:
   - the positive prompt
   - the reference instructions
   - the preservation instructions
   - `Avoid: <negative>`

   Each reference image is preceded by a short text part naming its index and role (e.g. "Reference 1 — master architecture: preserve massing, openings and proportions"). Keep reference order.

4. **Error mapping** to `ProviderErrorKind`:

   | Gemini result | Error kind |
   |---|---|
   | 401/403, or 400 with an API-key-invalid reason | `Auth` |
   | other 400 | `InvalidRequest` |
   | 429 | `RateLimited` |
   | 5xx, connection failure | `Network` |
   | client timeout | `Timeout` |
   | `promptFeedback.blockReason`, or a safety/prohibited finish reason | `Blocked` |
   | 200 without an image | `BadResponse`, message includes up to 200 chars of any text part |

   Messages are short and actionable. They must never contain the key or a raw body dump.
   Timeouts: 180 s for generate, 15 s for the connection test.

5. **`test_connection`** is a cheap authenticated GET (e.g. model metadata) that generates no image.

6. **Tests** run with no network and against a local mock server (std `TcpListener` thread or a small dev-dep). Cover:
   - request JSON shape: model path, header present, part order, inline data base64, image config
   - success parse (one and several images)
   - each error mapping
   - partial failure with several outputs
   - prompt composition
   - the key never appears in any error message

   Add one `#[ignore]` live smoke test that reads `ARCH_STUDIO_GEMINI_API_KEY`, for manual runs only.

## Done when

- `cargo test`, `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check` pass in `apps/desktop/src-tauri`.
- `docs/agent-notes/p2-gemini.md` is written, including:
  - the verified model ids and limits, with doc links
  - anything you could not verify
  - how to run the live smoke test
- Small commits on `wt/p2-gemini`.
