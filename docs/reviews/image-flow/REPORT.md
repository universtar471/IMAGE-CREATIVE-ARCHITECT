# Image generation and Multi-Angle flow repair

Base: `main` at `ea8e97d7da31a554e8ef7ba67a4adf51b30f3ca0`.
Local branch: `fix/image-generation-flow`. Remote publishing and merging are pending user review.

## Findings and changes

- Interior provider/model controls were nested inside the collapsed More options section. They now appear at the top of Generate, with model capability guidance in (?). The provider options exclude the local upscale provider, matching form resolution.
- The standalone Style screen had no onward action. It now has sticky Generate image and Multi-Angle actions. The inline interior style step also has an action that scrolls to the real generation button; it does not spend money itself.
- Removed the duplicate Rooms entry from navigation. Room selection remains inside Generate. Existing saved room data and legacy routes remain readable.
- Hid the exterior Architectural Detail navigation entry for interior projects. Interior furniture/material close-up camera views remain available.
- Added Camera generation controls at the top of the inspector: source image picker/import, provider/model/quality settings, explicit Generate camera view, spending confirmation, request errors and existing result/queue controls.
- Orbit now presents its source image beside the estimated proxy. Selecting a source keeps Orbit open. Rotation, tilt and distance still edit the same selected Camera DNA.
- Camera submission uses the selected image and model, the selected stable camera ID and a persisted Camera DNA prompt. Source preservation explicitly allows reframing to the requested camera. Original interior-camera locks must be explicitly unlocked. Missing/deleted cameras, missing source images, archived projects and invalid provider capabilities block submission.

## Reference video

Reviewed the complete 10.13-second `2899.mp4` supplied by the user. It demonstrates an image source, orbit/tilt/zoom controls and an explicit Generate action producing additional viewpoints. The previous M1 implementation supplied the estimated geometry controller but did not provide this complete image-to-generation entry point. This repair connects that entry point to the existing generation pipeline.

## Verification

- Typecheck, ESLint and frontend production build passed.
- Full test suite: **119 files, 1,256 tests passed**.
- After the last provider/error-display adjustment: **43 targeted tests passed** across five files.
- New coverage: Style onward navigation; visible model controls; explicit interior unlock; camera/image/model request identity; source preservation; source selection keeps Orbit; deleted camera blocks; exterior camera generation.
- Real Chromium acceptance: source/model selection, changing HHTECH model selection without contacting HHTECH, local mock generation request with the selected camera, Style to Generate, visible model controls, hidden redundant menu entries, inline style onward action, 1440×900 and 1100×700 layouts, VI/EN. No page errors. See `browser-results.json` and `tools/qa/image-flow-browser.mjs`.
- Existing Camera sync browser acceptance passed: Generate preset ↔ inspector ↔ Orbit/Director ↔ prompt, fractional camera pose, save/reopen, no paid commands. See `camera-regression/browser-results.json`.
- Full existing browser acceptance passed: responsive layouts, node selection/dragging, source imports, model selection, variation/video/enhance, region editing, grading, batch preview and original download. Original assertions were retained; only a temporary local browser-launch adapter was used. See `full-regression/r2-measurements.json`.
- `git diff --check` passed. No Rust code or migrations changed; native Windows execution was not rerun for these local UI changes.

## Screenshots

- `camera-image-model-vi.png`: Vietnamese camera source, model, orbit and generation action.
- `camera-image-model.png`: English equivalent.
- `generate-model-visible.png`: visible provider/model selection in Generate.
- `style-actions.png`: onward actions in the standalone Style screen.
- `style-next-create.png`: inline style action reaches the generation footer.
- `compact-create.png`: compact layout.

## Limits

- Orbit previews estimated geometry, not a recovered textured 3D model or a live AI image. Distance is the existing camera-distance control rather than a calibrated optical zoom.
- Browser generation uses an isolated mock transport and local placeholder model. No paid AI provider was called; photographic multi-view consistency is therefore not validated here.
- Existing model capabilities and spending confirmation apply. A generative image model may still infer unseen surfaces incorrectly.
- Build retains the existing large-bundle advisory.
