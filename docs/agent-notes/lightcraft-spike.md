# LightCraft spike handoff

## Result: GO, behind a narrow adapter

The pinned LightCraft CPU reference pipeline renders the requested 1696×2528 JPEG fast enough for interactive previews on this Windows machine. Keep integration behind one Rust adapter because the API is broad and versioned as a crate family; pin the same LightCraft revision and keep app-facing DNA independent of `DevelopSettings`.

## Measurements

- Input: `AST_01M4K1WV7ANCAQZEG3T6NQZV6T.jpg`, 1696×2528; source was only read.
- Cold `cargo build --release` after `cargo clean`: **66.6 s** on `x86_64-pc-windows-msvc`, rustc 1.98.0; finished successfully offline.
- `cargo tree --prefix none --format "{p}"`: **304 resolved tree entries, 168 unique package/version nodes** (includes image codecs and repeated dependency branches; not a before/after delta).
- Release executable: **8,558,592 bytes** (`target/release/lightcraft-spike.exe`).
- Build/link: succeeded for the MSVC target without extra system-library setup. The Rust MSVC toolchain and its normal linker/runtime are assumed present; this is not a clean-machine deployment test.

| Preset | Full render | 512 px fit preview |
|---|---:|---:|
| neutral | 57.3 ms | 11.2 ms |
| arch_clean | 149.0 ms | 16.4 ms |
| warm_dusk | 127.5 ms | 16.0 ms |
| cool_editorial | 108.4 ms | 12.1 ms |
| sky_recover | 96.0 ms | 13.5 ms |
| cinematic | 103.4 ms | 11.4 ms |

Preview is aspect-fit with the longest edge at 512, so this portrait source renders at 343×512. Timings are single in-process measurements and include the pipeline render call, not JPEG encoding.

## Implementation and API notes

- Fixed the spike's function-pointer call (`(preset.settings)()`) and kept separate JPEG encoders for LightCraft's raster `Rgba8` and the app's `image::RgbaImage` output.
- LightCraft is a deep develop model: `DevelopSettings` includes profile/treatment, WB, light/HDR, curves, color/mixer, grading wheels, effects, vignette/grain, detail, optics, geometry, masks, spots, and more. `controls::set` clamps known values and returns `false` for an unknown ID. Prefer direct adapter code for stable core fields and check every control result if using string IDs.
- This spike pins `964d9338bafac524146ecf24a1fab54bd22b052e`; changing revisions can change settings semantics and rendering. Hide those details behind a `lightcraft_adapter` module that converts the current grade DNA into `DevelopSettings`, converts the app's decoded image into LightCraft working-space pixels, invokes `render`, and converts the raster result back.

## Mapping and integration sketch

The current `ColorGradeDNA` already has `exposure`, `contrast`, `highlights`, `shadows`, `whites`, `blacks`, `temperature`, `tint`, `vibrance`, `saturation`, `clarity`, `dehaze`, and optional `look`. Suggested adapter mapping:

- Map contrast/highlights/shadows/whites/blacks, vibrance/saturation, clarity, and dehaze directly to the matching LightCraft fields; the ranges are both −100…100.
- Map exposure from DNA's −100…100 scale to LightCraft's −5…+5 EV (divide by 20).
- Rendered files use a 6500 K / 0 WB baseline. Map the current temperature scale to a relative Kelvin delta (the spike uses `6500 + 20 × temperature`, so +40 becomes 7300 K), set `wb.mode = Custom`, and clamp via the LightCraft control range. Calibrate this mapping visually before release; the existing fixed RGB temperature offset is only an approximation. Map tint to `wb.tint` and likewise compare output because the current DNA implementation applies a simple green-channel offset.
- The spike-only looks exercise native WB, texture, point curves, grading wheels, vignette, and grain. If these become user-editable, add versioned optional DNA fields for texture, WB mode/temperature basis, curve points, grading wheels, vignette, and grain (with defaults preserving old records). Keep `look` as a stable look identifier and resolve it to deterministic adapter settings rather than persisting LightCraft's whole settings struct.
- Integration path: add the adapter alongside `services/grade.rs`; preserve the current `ColorGrade` DTO and operation/version storage, then call the adapter from the grading service. Keep the current implementation available until parity vectors and visual review establish expected differences.
- For preset thumbnails, resolve preset settings once, run the existing `asset_preview` flow at its requested max edge through the adapter, and cache/store the preview using the existing managed-thumbnail path. Do not create a full-resolution graded asset just to populate a thumbnail.

## Recommendation and cost caveat

**GO for an isolated prototype/integration branch; not a drop-in replacement yet.** Full renders measured 57–149 ms and fitted 512 previews 11–16 ms, which is promising. The cost is a 66.6 s clean release build and 168 unique resolved package/version nodes. The current spike enables `image`'s default features, so its tree includes codecs the JPEG workflow does not need; before app integration, set `default-features = false` and retain only needed formats, then remeasure build size/time. Compare image quality and tune WB/exposure mappings before replacing the existing simple grade.

## Re-vendoring

`vendor/` and `.cargo/` are intentionally ignored. With network access to the pinned dependencies, from `tools/lightcraft-spike` run:

```powershell
cargo vendor --locked vendor > .cargo/config.toml
cargo build --release --locked --offline
```

The generated config replaces crates.io and the pinned LightCraft git source with `vendor/` and enables offline resolution. The vendor tree and generated config are local build inputs and must not be committed.

## Output files

`tools/lightcraft-spike/out/` contains:

- `lightcraft_neutral.jpg`, `lightcraft_arch_clean.jpg`, `lightcraft_warm_dusk.jpg`, `lightcraft_cool_editorial.jpg`, `lightcraft_sky_recover.jpg`, `lightcraft_cinematic.jpg`
- `ours_neutral.jpg`, `ours_arch_clean.jpg`, `ours_warm_dusk.jpg`, `ours_cool_editorial.jpg`, `ours_sky_recover.jpg`, `ours_cinematic.jpg`
- `report.json`
