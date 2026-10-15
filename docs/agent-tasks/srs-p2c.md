# SRS P2c — Optical and motion effects (ADR-036)

**Branch:** `wt/srs-p2c`. This task starts after `wt/srs-p2d` is merged, because it reads the scene-object schema.

## Read first

- ADR-036 in `docs/DECISIONS.md`
- SRS §6.1 and §6.2, and acceptance criteria AC-08 and AC-09
- In `packages/domain/src/` (read only):
  - `sceneObjects/*`
  - `spaceCatalog/*`
  - `site/*`
- `packages/domain/src/schemas/*`: the weather, lighting and time-of-day fields
- `validation/*`
- `prompt/sections/*`

## Scope

1. **Domain:** `packages/domain/src/effects/`
   - A catalog of the six SRS §6.1 effects:
     - long exposure on people or vehicles
     - long exposure on clouds or water
     - sunstar
     - lens flare
     - atmospheric glow and god rays
     - CPL / reflection control
   - Each effect has:
     - a Vietnamese user label: "Vệt sáng xe", "Người chuyển động mờ", "Mây mềm", "Nước mượt", "Tia sao", "Lóe sáng nhẹ", "Luồng sáng", "Giảm phản xạ kính"
     - an intensity of `light | medium | strong`
     - an English prompt fragment
   - Defaults: every effect is off, and a shot has one primary effect. Secondary effects are allowed only when they are compatible.
   - `effectsCompatibility(dna, shotIntent)` returns `{ effectId, status: available|conditional|blocked, reasonKey }[]`. It checks:
     - the space zone: an interior has no sky
     - the site: a road exists
     - the camera
     - the weather and lighting: trails need dusk or night
     - the scene objects: a moving vehicle is needed for trails
2. **Validator**
   - `EFFECT_SOURCE_MISSING` (BLOCK). Examples: clouds in a closed interior (AC-09), water blur without water, a sunstar without a light source.
   - `EFFECT_MOTION_CONFLICT` (BLOCK). Example: trails requested while the only vehicle is static (AC-08).
3. **ShotIntent:** add an optional field `effects: { primary?: { id, intensity }, secondary: [...] }`.
4. **Compiler**
   - Add an `EFFECTS` section in `prompt/sections/effects.ts`, following the SRS §6.2 example. It keeps the architecture static and sharp, and applies effects only to their real source.
   - Set `COMPILER_VERSION` to `"pc-1.8.0"`.
   - Output without effects must be unchanged apart from the version.
5. **UI:** `apps/desktop/src/features/effects/`
   - Effect cards with their Vietnamese names and a light, medium or strong slider.
   - Blocked effects are disabled and show a plain reason. Conditional effects show a hint.
   - The selection is stored in the per-project ShotIntent and goes through the gate.
   - Strings: Vietnamese with full diacritics, plus English.

## Out of scope

Do not touch the following, except to read them:
- `packages/domain/src/{detail,sceneObjects,contextLibrary,spaceCatalog,site}/**`
- `features/{detail,sceneObjects,enhance,space,site}/**`

## Done when

- `npm run verify` and `npx prettier --check .` are green.
- If Rust was touched, these pass in `apps/desktop/src-tauri`:
  - `cargo fmt --check`
  - `cargo clippy --offline --all-targets -- -D warnings`
  - `cargo test --offline`
- `docs/agent-notes/srs-p2c.md` is written.
- Do not commit. Do not touch `.env`. Make no paid calls.
