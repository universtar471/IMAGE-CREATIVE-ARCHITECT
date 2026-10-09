# P4 fix — grade live preview fails in the desktop app (tainted canvas)

Branch `wt/p4-preview-fix` (from main). Bug found by the user's manual test of Phase 4 on 2026-10-10.

## Symptom

In the real Tauri app (`npm run dev`), the Mood / Grade live preview never shows graded pixels. The dev log is full of:

```
[Unhandled error] SecurityError: Failed to execute 'getImageData' on 'CanvasRenderingContext2D': The canvas has been tainted by cross-origin data.
```

## Cause

- `features/mood/GradeCanvas.tsx` loads the asset with `new Image()` from `fileUrl()`.
- In Tauri, `fileUrl()` is `convertFileSrc()`, which is `http://asset.localhost/...`. That is a different origin from the webview (`http://localhost:1420` in dev, `tauri://localhost` / `http://tauri.localhost` in builds).
- Drawing it taints the canvas, so `getImageData` throws.
- The mock backend uses `blob:`/`data:` URLs, so the browser preview and the tests never hit this.

The same effect also reloads and re-decodes the image on every slider change, because the grade is in the effect deps. That is wasteful at 1600 px.

## Scope

1. **Backend command `asset_preview`.**
   - Request: `{ projectId, assetId, maxEdge }`. Clamp `maxEdge` to 256..4096; the UI sends 1600.
   - It returns the asset image downscaled to fit `maxEdge` (never upscaled), PNG-encoded, as a raw binary IPC response (`tauri::ipc::Response`), not JSON/base64.
   - Validate that the asset belongs to the project and is ready. Read and resize without holding the DB lock (as `grade_apply` does).
   - The source file is never modified.
   - Register the command.
   - Rust tests:
     - downscale size and aspect
     - no upscale
     - wrong project rejected
     - missing asset rejected
2. **Bridge.**
   - Add a typed helper (e.g. `assetPreview(...) : Promise<Blob>`) in `lib/bridge.ts` or a small module next to it.
   - It calls `invoke` and wraps the returned `ArrayBuffer` / `Uint8Array` in a `Blob({type:"image/png"})`.
   - Mock backend: return a Blob from the mock asset's data the same way (so the mock path also exercises the new code).
   - Document the command in `docs/API_CONTRACTS.md` as §12.5. It is binary, so note that it is excluded from the JSON contract fixtures.
3. **GradeCanvas.**
   - Load the pixels once per asset (and on asset change): `assetPreview(...)` → `createImageBitmap(blob)` → draw to an offscreen canvas → keep the original `ImageData` in a ref.
   - On grade / mode / split change, only regrade from the cached original (chunked as now) and repaint. Do not refetch.
   - Cancel stale work on asset change / unmount.
   - Catch load and `getImageData` errors and show a short inline message (en + vi strings) instead of an unhandled error.
   - Never use `fileUrl()` for pixel reads. Keep `fileUrl()` for plain `<img>` display elsewhere.
4. **Tests.**
   - Vitest:
     - GradeCanvas fetches the preview once for several grade changes
     - it regrades on change
     - it shows the error message when loading fails
   - Rust tests as above.

## Done when

- `npm run verify` is green.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `npx prettier --check .` are clean.
- `docs/agent-notes/p4-preview-fix.md` is written.
- The lead checks the real app afterwards: the log no longer shows the SecurityError, and the preview changes when a slider moves.
