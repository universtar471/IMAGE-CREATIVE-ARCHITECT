# Review: colour grade v2 engine, LUT library backend, grade v2 domain (ADR-031)

Branch: `wt/grade-core`.
Verdict: **ĐẠT** (pass).

## Verification (run by the lead)

- `npm run verify` passes:
  - typecheck and lint
  - 565 JS tests
  - the Rust suite
- `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` are clean.
- `npx prettier --check .` is clean.

## Checked

**Engine**
- `services/grade_engine.rs` is the only LightCraft importer.
- Grades with only v1 fields use the unchanged v1 pixel path; a test asserts they are identical.
- Any v2 field renders through LightCraft, then the optional LUT with its strength.

**LUT safety**
- LUTs are resolved only by id through the `luts` table. A path-like id (`../../x.cube`) returns `NOT_FOUND`.
- The scan:
  - rejects symlinked sources and skips symlinked entries
  - accepts only normal relative path components
  - caps files at 5,000 and file size at 64 MB
- Remove deletes only the index and the cached previews, never user files.
- The preview cache is checked before re-parsing a file. A missing file sets the status to `missing`.

**Validation**
- The v2 ranges are enforced in Zod and in Rust: grain 0..100, hue 0..360.
- The JSON schema is regenerated.

**Presets**
- The values were tuned on the user's master against numeric targets.
- The lead reviewed them visually. Earlier rounds blew out the facade (concrete_steel) and turned the sky teal (clean_editorial); both were fixed.

## Fixed during review

- `lut_from_grade` read `lutId` as a file path (arbitrary file read). It was replaced by an id lookup.
- Lint errors (`any`, an unused argument, an `import()` type) were fixed.

## NÊN SỬA (should fix, not blocking)

1. `grade_preview` and `lut_preview` decode the full asset on every call. If preview latency shows in the UI, cache a downscaled source per asset.
2. `examples/grade_tuning.rs` is a dev tool. It reads any path given on the command line, which is fine for local use. Do not expose it as a command.
