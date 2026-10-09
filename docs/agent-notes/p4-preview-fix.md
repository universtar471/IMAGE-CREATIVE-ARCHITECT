# wt/p4-preview-fix

- Agent: codex
- Branch: wt/p4-preview-fix
- Commit: none (per task instruction)

## Goal

Fix the tainted-canvas Mood / Grade live preview in the Tauri desktop app.

## Completed

- Added the `asset_preview` Rust service and Tauri command. It validates project ownership and ready image status, clamps `maxEdge` to `256..4096`, reads outside the DB lock, downsizes without upscaling, and returns PNG bytes through `tauri::ipc::Response`.
- Registered the command and documented API contract section 12.5.
- Added typed bridge `assetPreview()` binary handling for Blob, ArrayBuffer, and Uint8Array; added the equivalent mock backend path.
- Reworked `GradeCanvas` to fetch/decode once per asset through `createImageBitmap`, cache original `ImageData` offscreen, repaint only on grade/mode/split changes, cancel stale work, and show a localized load/readback error.
- Added Vitest regression coverage for one-fetch/regrade behavior and load errors, plus Rust preview resize and validation tests.

## Verification

- `npm.cmd run verify` passed: 323 Vitest tests and 230 Rust tests passed (5 ignored).
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check` passed.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings` passed.
- `npx.cmd prettier --check .` passed.

## Notes

- The mock preview returns the source asset Blob; the bridge normalizes its MIME type to `image/png` for the canvas pipeline.
- `fileUrl()` remains available for ordinary `<img>` display paths; `GradeCanvas` no longer uses it for pixel reads.

## Round 2

- Added `assetPreview` coverage for `ArrayBuffer`, an offset typed-array view, and a plain `number[]`.
- `assetPreview` now validates every plain-array byte as an integer in `0..255`, then returns an `image/png` Blob; invalid arrays raise `BridgeError`.
- Targeted preview tests pass; `npm.cmd run verify` and `npx.cmd prettier --check .` are green.
