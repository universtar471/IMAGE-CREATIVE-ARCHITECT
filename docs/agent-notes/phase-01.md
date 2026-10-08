# wt/phase-01

- Agent: claude
- Tach tu: main
- Tao luc: 2026-10-08 12:26

## Muc tieu

Implement Phase 1 (local core + permanent UX shell) per `CLAUDE.md` and `tasks/PHASE_01.md`.

## Da xong

P1-01 → P1-15 implemented. See `docs/PROGRESS.md` for the per-task list and
`docs/DECISIONS.md` ADR-008…011 for the design choices made during implementation
(TS/Rust split, derived status, duplicate handling, double-enforced master uniqueness).

## Con no

- P1-16 manual scenario in the native window was not driven by the agent (desktop control
  was not granted). Needs a human pass: import 4 images via the dialog, assign roles,
  switch master, close/reopen, archive/restore, check at 1366×768.
- No thumbnail regeneration for assets whose preview file is missing (they show an icon).
- Knowledge Packs are bundled at build time; no runtime pack editing.

## Lenh test

```bash
npm install
npm run verify          # typecheck + lint + vitest + cargo test
npm run dev             # desktop app (ARCH_STUDIO_DATA_DIR=<dir> for a throwaway profile)
```

## Cam bay da gap

- PowerShell 5.1 `Set-Content -Encoding utf8` writes a BOM → Tauri fails to parse
  `tauri.conf.json` ("expected value at line 1 column 1"). Write JSON without BOM.
- `ulid` 3.x: use `Ulid::generate()` (no `Ulid::new()`).
- `eslint-plugin-react-hooks` 7 flags setState inside effects; ImageViewer derives the
  fitted view during render and NumberField syncs external values during render.
- Prettier must not touch `packages/domain/schema/` (the Rust side embeds the exact file
  and a test compares it to the Zod export).
- Vite dev server port 1420 is shared by the browser preview and `tauri dev`; stop one
  before starting the other.
