# gateway-no-timeout-retry

Goal: the user asked that HHTECH timeouts are not retried automatically (a paid gateway may
bill a call the app stopped waiting for).

Done:
- `ImageProvider::auto_retries_timeouts` (default true). The OpenAI adapter returns false in
  gateway flavor (HHTECH), true for official OpenAI.
- `queue::settle` asks the job's provider; `auto_retries(kind, timeouts)`. Rate limits and
  network errors are still retried. The failed job keeps `retryable: true` so Retry works.
- Tests: `timeouts_are_not_retried_for_providers_that_opt_out` (queue),
  `the_gateway_timeouts_are_left_to_the_user_but_official_openai_retries` (hhtech).
- ADR-017 amended, README row updated.

Test: `npm run verify`.
