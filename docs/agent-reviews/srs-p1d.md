# Review: wt/srs-p1d (Context Library V4 wiring)

**Verdict: ĐẠT. Merged.**

Codex (HHTECH) started this branch. It could not reach its patch tool and left only three files. A Claude subagent finished the work and fixed bugs in both the Codex code and the merged `suggest.ts`.

The most important fix: the party-wall cue was dropped for every townhouse, because the front side is always a street.

## Lead verification (after merging main)

| Check | Result |
|---|---|
| vitest | 76 files, 909 tests pass |
| typecheck, lint, prettier | clean |
| Rust tests | 308 pass, 6 ignored |

## NÊN SỬA (later)

- Suggestion lines appear in English only, because the library has no Vietnamese text.
- The evidence-drop rules are regexes tuned to the 53 current presets. Review them whenever the library grows.
