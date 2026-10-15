# Review: wt/srs-p2d (ADR-036 P2d)

**Verdict: ĐẠT. Merged.**

Codex (via Volibear) built the first version and stopped when the credit ran out. A Claude subagent finished the work and fixed the following Codex bugs:
- Placement text written by the user leaked into the prompt.
- The "verified" check was too lenient.
- `cameraId` was lost when a ShotIntent was present.
- Refused objects were still compiled into the prompt.
- Empty DTO fields were serialized as `null`.

## Lead verification

| Check | Result |
|---|---|
| vitest | 68 files, 779 tests pass |
| typecheck | clean |
| lint | clean |
| prettier | clean |
| `cargo fmt` | clean |
| cargo tests | 287 pass, 6 ignored |

## NÊN SỬA (later)

- **Villa yard cars are always blocked.** No UI can record a verified driveway, hardscape or garage bay. This needs a fact editor in the space wizard.
- **Showroom exception and cafe/restaurant rows** are missing from the allowed table.
- **No collision or locked-element occlusion checks.** Only the prompt wording guards against these.
- **ShotIntent is session-only.** It is lost when the app restarts.
- **Merge note for P2a, P2b and P2c:** `setShotIntent` decides whether an intent is empty by looking at three fields only. A branch that adds new ShotIntent fields must also add them to that check.
