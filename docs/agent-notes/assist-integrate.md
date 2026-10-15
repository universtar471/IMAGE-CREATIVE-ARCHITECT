# wt/assist-integrate

- Agent: claude (integration of codex branches wt/assist-core and wt/assist-ui)
- Goal: ADR-030 — AI DNA assist, Space panel layout, preset photos, compiler pc-1.6.0.

## Done
- Domain assist helpers, Rust `dna_assist` command, HHTECH_ASSIST_MODEL (default gemini-3.8-flash).
- UI: resizable right panel, AI suggest popover + diff sheet, translate chip, master DNA sync,
  Space panel stacked/split layout, 48 WebP preset photos with manifest and SVG fallback.
- Compiler pc-1.6.0: primary + accents, wide camera fallback.

## Open
- See docs/agent-reviews/assist.md "NÊN SỬA".

## Test
- `npm run verify`, `npx prettier --check .`, cargo fmt/clippy in apps/desktop/src-tauri.

## Pitfalls
- New worktrees have no node_modules: run `npm ci --prefer-offline` before verify.
- HHTECH agents can hang after their last test run; the watchdog idle limit catches it.
