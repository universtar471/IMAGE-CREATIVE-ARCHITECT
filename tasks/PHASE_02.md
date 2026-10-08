# Phase 2 — Provider-neutral AI foundation

Goal (docs/ROADMAP.md): provider registry, secure provider configuration, model capability
descriptors, a first generation adapter, generation persistence, the Hero image workflow,
version lineage, and History in the existing bottom tray.

Decisions: ADR-012…015 in `docs/DECISIONS.md`. Contracts: `docs/API_CONTRACTS.md` §9.
Shared contract code already on `main` (do not redesign it; extend it if you must and say so
in your agent note):
- `packages/domain/src/schemas/generation.ts` — Zod DTOs (source of truth for JSON shapes)
- `apps/desktop/src-tauri/src/providers/mod.rs` — `ImageProvider` trait, request/response
  types, `ProviderRegistry::builtin()` (gemini + local_preview)
- `apps/desktop/src-tauri/migrations/0002_generations.sql` — `generations`,
  `generation_outputs`, `versions.generation_id`
- `ErrorCode::ProviderNotConfigured` / `"PROVIDER_NOT_CONFIGURED"`
- `apps/desktop/src-tauri/rustfmt.toml` (max_width 120) — run `cargo fmt` before committing

## Work split (parallel worktrees)

| Task | Branch | Owns | Brief |
|---|---|---|---|
| P2-A backend core | `wt/p2-backend` | `src-tauri/src/**` except `providers/gemini.rs` | `docs/agent-tasks/p2-backend.md` |
| P2-B Gemini adapter | `wt/p2-gemini` | `src-tauri/src/providers/gemini.rs` (+ its tests, dev-deps) | `docs/agent-tasks/p2-gemini.md` |
| P2-C UI | `wt/p2-ui` | `apps/desktop/src/**`, `apps/desktop/tests/**`, `packages/domain/**` | `docs/agent-tasks/p2-ui.md` |

A and C meet only at the JSON contract (§9). B meets A only at the trait. Do not edit files
another task owns; if the contract is wrong, write it in your agent note.

Merge order: P2-A → P2-B → P2-C, each after review is ÐẠT and `npm run verify` is green.

## Phase 2 acceptance (whole phase)

1. `npm run verify` green (typecheck, lint, vitest, cargo test, clippy 0 warnings).
2. With `local_preview`: create project → import master → Generate (Hero) → output appears
   in canvas, Assets, Versions (child of master's version) and History; "Use as master"
   promotes it; close/reopen keeps everything.
3. With `gemini` and a real key in the OS credential store: same flow produces a real image.
   Missing/invalid key → actionable message, no crash, failed entry in History.
4. API key never appears in SQLite, logs, localStorage, zustand state or any DTO.
5. App closed mid-generation → that entry shows `interrupted` on next start.
6. Jobs tray tab stays a Phase 3 placeholder. Camera/Lighting/Mood stay placeholders.

Do not start Phase 3.
