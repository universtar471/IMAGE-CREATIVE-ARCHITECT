# hhtech-timeout

Goal: a real HHTECH run timed out three times (two outputs, 300 s timeout, ~100 s per image
through the gateway) and the queue retried it to the attempt limit.

Done:
- Gateway flavor sends several outputs as parallel `n=1` calls (`OpenAiProvider::parallel_calls`).
  Partial success keeps the images and records `meta.failedCalls`; all failing returns the
  first error with its kind.
- Gateway generate timeout: 600 s default, `HHTECH_TIMEOUT_SECS` (30–3600). Official OpenAI
  provider unchanged (300 s, single call with `n`).
- Tests in `providers/hhtech/tests.rs`; README + `.env.example`.

Open:
- A timeout is still retryable, so a stuck gateway can cost up to 3 attempts; consider a
  per-provider retry policy for paid gateways.
- Partial success is not surfaced in the UI beyond the image count.

Test: `npm run verify`; `cargo test hhtech` in `apps/desktop/src-tauri`.
