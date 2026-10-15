# Review: wt/srs-p0 (ADR-034 P0-A + P0-B)

**Verdict: ĐẠT. Merged.**

## Verification by the lead

The lead re-ran every check in the worktree.

| Check | Result |
|---|---|
| `npm run verify` (vitest) | 61 files, 675 tests passed |
| Rust tests | 286 passed, 6 ignored (these were already ignored before this branch) |
| `npx prettier --check .` | clean |
| `cargo fmt --check` | clean |
| `cargo clippy --offline --all-targets -- -D warnings` | clean |

On the first run, `hhtechModels.test.tsx` hit a timeout while the full suite was running. The test passed when run alone and passed on the second full-suite run. The flake is load-related and unrelated to this branch.

## Checked

- `features/validation/gate.ts`:
  - It is pure. Only `ALLOW` may submit.
  - Batch items that are not `ALLOW` are dropped before `batch_create` is called.
  - `withValidation` stamps the verdict and the accepted WARN codes into the bundle.
- `services/generations.rs`, `ensure_not_blocked`:
  - It runs before any row is written.
  - The conservative snapshot keeps `validation`.
  - Old snapshots without `validation` are accepted.
- `services/batches.rs`: a BLOCK item refuses the whole batch, and no rows are written.
- The store gate uses the real `cameraId`. The Generate panel passes `null` because that panel submits without a camera.

## NÊN SỬA (later phases)

- `job_retry` replays the stored snapshot without re-validating it against the current DNA.
- These surfaces have no exception panel, so a WARN item is skipped with a toast:
  - ContactSheet re-run batch
  - Mood variations
  - Enhance batch
- The compiler pre-fills `resolvedWarnings` with the DNA's WARN codes, which mixes "found" with "accepted". Narrow it to accepted codes in P1, together with `pc-1.7.0`.
- `EnhanceBatchDialog.tsx` has mojibake in the batch name (`Â·`). This existed before the branch.
