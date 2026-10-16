# Review: wt/srs-debts-2

**Verdict: ĐẠT. Merged.**

## Lead verification

Run after merging main, which now includes P4.

| Check | Result |
|---|---|
| vitest | 85 files, 1035 tests pass |
| typecheck, lint, prettier, clippy | clean |
| Rust tests | 324 pass, 6 ignored |

The compiler moved to `pc-1.9.0` because prompt text changes for some existing inputs. No golden text changed. The `"pc-1.8.0"` string left in `srs-p3-enhance.test.ts` sits in a hand-built request fixture and is harmless.

## NÊN SỬA (later)

- `floorId` is stored but does not reach the prompt.
- For interior shots, the front, street_oblique and pedestrian intents still suggest exterior views.
- Locked elements are protected by prompt wording only. No validator check backs them.
