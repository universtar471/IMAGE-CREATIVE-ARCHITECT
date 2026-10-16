# Review: wt/srs-p2c (ADR-036 P2c)

**Verdict: ĐẠT. Merged.**

The Codex run on HHTECH changed no files: it could not reach its patch tool. A Claude subagent then did the whole task.

## Changes by the lead at merge time

- **Compiler conflict.** The P2c conflict with P1d in the compiler was resolved as a union. The section order is now camera → detailTarget → sceneObjects → effects → contextSuggestions → quality.
- **Effects lost on last-object removal.** In `SceneObjectsPanel.tsx`, removing the last scene object called `setShotIntent(undefined)`, which also dropped the effects, the visual intent and the detail choices. The panel now always writes the intent, and the store's emptiness check decides whether to drop it.

## Lead verification (after merging main)

| Check | Result |
|---|---|
| vitest | 78 files, 937 tests pass |
| typecheck, lint, prettier, cargo fmt | clean |
| Rust tests | 308 pass, 6 ignored |

## NÊN SỬA (later)

- Water, weather and lighting are detected by keywords, so these signals can only make an effect "conditional".
- Rust always serialises `secondary: []`. The desktop always sends the array, so snapshots match.
