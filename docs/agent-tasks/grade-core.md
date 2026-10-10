# Colour grade v2 engine + LUT library backend (ADR-031, API §21.1–21.2)

**Branch:** `wt/grade-core`.

**You own:**
- `packages/domain/src/grade/**` and its tests
- `apps/desktop/src-tauri/**`
- `apps/desktop/src/lib/mockBackend.ts`, only for the `lut_*` and `grade_preview` mocks
- `apps/desktop/tests/fixtures/backend/**`
- `THIRD_PARTY_NOTICES.md`
- the generated JSON schema files

`wt/assist-core` runs in parallel and also touches `src-tauri` (`dna_assist`) and `packages/domain` (`assist`, compiler). Keep your changes in grade, LUT and new files. Do not edit compiler or assist files.

## Read first

- ADR-013, ADR-031; API §21.
- The spike: `git show wt/lightcraft-spike:docs/agent-notes/lightcraft-spike.md` and `git show wt/lightcraft-spike:tools/lightcraft-spike/src/main.rs`. Its API mapping already works.
- `services/grade.rs`, `packages/domain/src/grade/*` and the parity vectors, `db.rs` migrations, `commands.rs`.

## Scope

1. **Dependencies**
   - Add `lightcraft-develop`, `lightcraft-pipeline` and the `lightcraft-*` crates they need as git dependencies at `rev = "964d9338bafac524146ecf24a1fab54bd22b052e"`. Use `package =` as the spike did.
   - Commit the `Cargo.lock` change.
   - Add `THIRD_PARTY_NOTICES.md` with the LightCraft licence notice.
   - If the sandbox blocks cargo network access, stop and write in the agent note exactly which command the lead must run. The lead can pre-fetch or vendor outside the sandbox, as was done for the spike. Do not commit a vendor directory.
2. **Engine.** `services/grade_engine.rs` per §21.2: the only LightCraft importer. v1 fields map through it, and v1 grade outputs stay visually equivalent; add a tolerance test on the existing grade test images. Add a LUT parser and trilinear apply with a strength blend.
3. **Domain** per §21.1: the v2 fields in the Zod schema, the presets, `gradePresetsForStyle`, `ARCH_LUT_FILTER` and `isLogLut`. Regenerate the JSON schema. Rust validation accepts v2 and rejects out-of-range values.
   - Tune the five style presets by rendering them on the user's master:
     `C:/Users/Admin/AppData/Roaming/com.archaistudio.desktop/projects/PRJ_01M4K1GRP7VDA7D8QJ7N42B6JA/assets/original/AST_01M4K1WV7ANCAQZEG3T6NQZV6T.jpg`
     The file is read-only. Write the outputs to a gitignored `tools/grade-tuning/out/`.
   - Target looks:
     - **earthy_muted:** saturation −20, soft texture/clarity, lifted blacks, slightly warm
     - **heritage_warmth:** deeper contrast and shadows, warm, orange/brown boost
     - **clean_editorial:** bright whites with highlights held, neutral white balance
     - **tropical_forest:** greens shifted toward natural yellow-cyan and less saturated, soft contrast
     - **concrete_steel:** contrast +, clarity +, cooler, slight desaturation
4. **Migration and commands** per §21.2, with all the listed tests. LUT fixtures are generated in the tests.
5. **Mock backend** for `lut_*` and `grade_preview`.

## Done when

- `npm run verify` is green.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` (manifest `apps/desktop/src-tauri/Cargo.toml`) and `npx prettier --check .` are clean.
- `docs/agent-notes/grade-core.md` is written, with build-time and binary-size deltas.
- No paid API calls.
