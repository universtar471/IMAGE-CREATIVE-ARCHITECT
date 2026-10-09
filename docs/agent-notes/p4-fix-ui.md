## Da xong

- Contact Sheet variation groups resolve the persisted preset label and render the translated
  `Adopt this mood` action. Adoption writes every unlocked section returned by the domain adapter.
  Test: `adopts the preset selected from a Contact Sheet group`.
- Mood adoption writes lighting, weather, and mood, including partial lighting values such as
  `timeOfDay`. Mood/weather selectors use `presetId`; weather merges direct API 12.2 values with
  a legacy nested fallback. Tests cover section adoption, selector ids, and weather merging.
- Grade apply selects its result only when the original project remains open. Test: `does not select
  a grade result after switching projects`.

## Lenh test

- `npm.cmd run typecheck --workspaces --if-present` - PASS.
- `npm.cmd run lint` - PASS.
- `npm.cmd test` - PASS (24 files, 313 tests).
- `npx.cmd prettier --check .` - PASS.
- `npm.cmd run verify` passed TypeScript, lint, and Vitest, then Rust failed because D: had 0 bytes
  free while Cargo created `apps/desktop/src-tauri/target` (OS error 112). The generated target
  cache was removed before retrying, but the drive remained full.

## Cam bay

- Variation jobs persist the preset label, so Contact Sheet resolves it against the current pack;
  unknown labels intentionally render without an adopt action.
