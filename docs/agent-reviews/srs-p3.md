# Review: wt/srs-p3 (ADR-035)

**Verdict: ĐẠT. Merged.**

Codex (via Volibear) started this work and stopped when the credit ran out. A Claude subagent finished it and fixed seven Codex bugs. They are listed in `docs/agent-notes/srs-p3.md`.

## Lead verification

| Check | Result |
|---|---|
| vitest | 70 files, 818 tests pass |
| typecheck | clean |
| lint | clean |
| prettier | clean |
| cargo fmt | clean |
| cargo clippy | clean |
| cargo test | 306 pass, 6 ignored |

Migration 0008 does not clash with main, which ends at 0007.

## NÊN SỬA (later)

- **Allowed-region mask:** the mask is not sent to the provider. Locked regions are only composited back afterwards.
- **Batch balanced/creative:** these batches have no per-image region, so the whole frame counts as editable and every result is flagged "Cần xem lại".
- **Check thresholds:** they are tuned on synthetic images, and the checks run at 256 px.
- **`UpscaleProviderCapabilities`:** the type is not added yet. It belongs with P6, when the providers arrive.
