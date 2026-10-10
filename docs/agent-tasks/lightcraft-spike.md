# Spike — LightCraft develop pipeline for colour grading (go / no-go)

**Branch:** `wt/lightcraft-spike`. This is a throwaway measurement. **Do not touch the app**: no changes to `apps/**` or `packages/**`.

## Goal

Decide whether to replace the naive local grade in `apps/desktop/src-tauri/src/services/grade.rs` with the LightCraft crates `lightcraft-develop` and `lightcraft-pipeline` (CPU reference pipeline). LightCraft is <https://github.com/storytold/lightcraft>, licensed MIT OR Apache-2.0.

## Scope

1. Create a standalone crate `tools/lightcraft-spike/` with its own `[workspace]`, so it is excluded from the app build.
   - Add `lightcraft-develop` and `lightcraft-pipeline` as git dependencies pinned to `rev = "964d9338bafac524146ecf24a1fab54bd22b052e"`. If the workspace inheritance makes path or git deps fail, use `git` with `package = …`. Record exactly what was needed.
   - Gitignore `tools/lightcraft-spike/target` and `tools/lightcraft-spike/out`.
2. Write a CLI `cargo run --release -- <input.jpg|png> <out_dir>`. It:
   - loads the image
   - renders these settings through the LightCraft pipeline, each written as JPEG to `out_dir`:
     - **neutral**: no change
     - **arch_clean**: highlights −40, shadows +30, whites +10, blacks −10, clarity +15, dehaze +10, vibrance +15
     - **warm_dusk**: white balance warmer, about +800 K relative or the equivalent tint, highlights −30, colour grading with warm highlights and teal shadows, vignette −15
     - **cool_editorial**: cooler, contrast +15, saturation −10, texture +10
     - **sky_recover**: highlights −80, dehaze +25
     - **cinematic**: a tone curve gentle S, split tone teal/orange, grain light
   - Map each to the real LightCraft settings fields and presets. Read `crates/develop/src/{settings,controls,presets}.rs` and the pipeline API.
   - Writes a `report.json` with, per preset, the render time in ms at full size and at a 512 px preview, plus the image size.
3. Measure and write these to `docs/agent-notes/lightcraft-spike.md`:
   - cold `cargo build --release` time for the spike
   - `cargo tree` count of new crates
   - the release binary size of the spike
   - the per-preset render times on CPU, Windows
   - whether it builds on Windows MSVC without extra system libraries
   - API stability notes: how deep the API is, and whether a thin adapter can isolate it
   - how our `ColorGrade` fields (exposure, contrast, temperature, saturation…) would map
   - a recommendation (go / no-go), with an integration sketch: adapter module, DNA fields to add, and a preset thumbnail flow using the existing `asset_preview` command
4. The input image for the run is the user's master:
   `C:/Users/Admin/AppData/Roaming/com.archaistudio.desktop/projects/PRJ_01M4K1GRP7VDA7D8QJ7N42B6JA/assets/original/AST_01M4K1WV7ANCAQZEG3T6NQZV6T.jpg`
   - Treat it as read-only.
   - Output goes to `tools/lightcraft-spike/out/`, which is gitignored and must not be committed.
   - Also render the same image with our current grade: copy `apply_grade` logic from `grade.rs` into the spike as `ours_*.jpg`, using comparable settings, for a side by side.

## Done when

- The CLI runs and the outputs and `report.json` exist.
- The agent note is complete.
- Nothing outside `tools/lightcraft-spike/`, `.gitignore` and the agent note is changed.
- No API calls are made, except cargo fetching crates and git.
