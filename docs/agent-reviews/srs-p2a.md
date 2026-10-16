# Review: wt/srs-p2a (ADR-036 P2a)

**Verdict: ĐẠT. Merged.**

Codex built this on HHTECH with gpt-6-sol. Codex reported about 650k tokens.

## Lead verification

Checks were run after `main` (P3) was merged into the branch.

| Check | Result |
|---|---|
| vitest | 72 files, 823 tests pass |
| typecheck, lint, prettier | clean |
| cargo fmt, clippy | clean |
| Rust tests | 306 pass, 6 ignored |

## NÊN SỬA (later)

- `camera/intent.ts` `availableIntents`: `interior` is true whenever `dna.interior` exists. Because of this, an interior project whose active space is a garden still hides the aerial view.
- `VIEW_SUGGESTIONS` maps `overview` and `approach` to `exterior_front` even for interior projects. These two need interior view types once the interior camera presets are wired in.
- The intent is kept only for the current session.
