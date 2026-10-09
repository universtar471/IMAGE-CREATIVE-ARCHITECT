# Phase 4 — Lighting / Weather / Mood / Grade

Goal (docs/ROADMAP.md): Lighting panel, artificial lighting, weather presets, seasonal and
tropical mood presets, color grade controls, lock system, mood variations, all inside the
existing right-panel/canvas shell.

Decisions: ADR-019…021. Contracts: `docs/API_CONTRACTS.md` §12.

Coding agents: Codex through the HHTECH profile (`codex exec -p hhtech`), one worktree per
task. Reviews: Codex default profile (read-only). Claude assigns, commits on behalf of the
Codex sandbox (it cannot write the gitdir), verifies, merges.

## Work split (parallel worktrees from `main`)

| Task | Branch | Owns | Brief |
|---|---|---|---|
| P4-A domain | `wt/p4-domain` | `packages/domain/**`, `knowledge/**` | `docs/agent-tasks/p4-domain.md` |
| P4-B backend | `wt/p4-backend` | `apps/desktop/src-tauri/**`, `apps/desktop/tests/fixtures/backend/**` | `docs/agent-tasks/p4-backend.md` |
| P4-C UI | `wt/p4-ui` | `apps/desktop/src/**`, `apps/desktop/tests/**` except fixtures | `docs/agent-tasks/p4-ui.md` |

Merge order: P4-A → P4-B → P4-C, then `npm run verify` and the grade parity test on the
merged result.

## Phase 4 acceptance

1. `npm run verify` green; grade TS/Rust parity test passes on the shared vectors.
2. **Lighting module** (sidebar "Ánh sáng / Lighting" enabled): time of day, sun direction and
   elevation, intensity, shadows, ambient; artificial lights list (add/remove/toggle, zone,
   colour temperature, intensity); lighting presets from the pack; weather presets and fields.
   Autosaves with the DNA; prompt preview shows the new sections.
3. **Mood / Grade module** enabled: mood presets and fields; color grade sliders + looks with
   live before/after preview on the canvas; "Apply grade" creates a new asset + version
   (`color_grade`) and the source stays unchanged; "Save as project grade" writes `colorGrade`.
4. **Locks**: lock toggles for lighting, weather, mood, color grade; locked sections are
   read-only, appear as preservation lines in the prompt, and are skipped by mood variations.
5. **Mood variations**: from the master (or a selected output) pick 2–8 presets → one batch,
   results on the Contact Sheet grouped by preset; "Adopt this mood" writes the preset into
   the DNA.
6. All new UI text exists in both `en` and `vi` dictionaries; Vietnamese is natural.
7. Phase 1–3 behaviour unchanged.

Do not start Phase 5.
