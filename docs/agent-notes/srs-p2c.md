# wt/srs-p2c — SRS P2c: optical and motion effects (ADR-036)

- Agent: Claude Code. Branch `wt/srs-p2c` (main already merged in, incl. P2a/P2b/P2d/P5a). Nothing committed; the lead commits.
- Versions unchanged: `COMPILER_VERSION = "pc-1.8.0"`, `VALIDATOR_VERSION = "cv-1.2.0"`. The two codes `EFFECT_SOURCE_MISSING` / `EFFECT_MOTION_CONFLICT` (BLOCK, P2) and their `conflicts.*` strings were already registered; P2c now raises them.

## Done

- **Domain `packages/domain/src/effects/`** (new, exported from the package index)
  - `schemas.ts`: `EFFECT_IDS` (8 user effects), `EFFECT_FAMILIES` (the 6 SRS §6.1 families), `EffectIntensity` `light|medium|strong`, `EffectChoice { id, intensity }`, `ShotEffectsSchema { primary?, secondary: EffectChoice[] (max 2, default []) }`, `hasEffects()` (true only with a primary).
  - `catalog.ts`: `EFFECT_CATALOG` with `labelVi` exactly "Vệt sáng xe", "Người chuyển động mờ", "Mây mềm", "Nước mượt", "Tia sao", "Lóe sáng nhẹ", "Luồng sáng", "Giảm phản xạ kính", plus `labelEn`, `promptEn` (with `{intensity}` → subtle / moderate / strong) and a `guardEn` line.
  - `compatibility.ts`: `effectScene(dna, shot)` (derived facts) and `effectsCompatibility(dna, shot)` → `{ effectId, status, reason, reasonKey: "effects.reasons.<reason>", code? }[]` in catalog order. It reads:
    - space zone: the target / active catalog space's preset zone, else the project type (`interior` = enclosed);
    - site: a `street` boundary from `resolveSiteAdjacency` (confirmed = verified, inferred = conditional);
    - camera: detail views make clouds conditional, aerial or elevation ≥ 60° makes reflection control conditional;
    - lighting / weather: time class from `interior.timeOfDay` / `lighting.timeOfDay` (enum, else preset text), overcast from the weather text, artificial lights enabled; interior openings from `interior.daylightDirection` or window/opening facts;
    - water: pool space (P2d `sceneSpaceKind`), water facts of the space, else water words in the context text (conditional only);
    - scene objects (P2d schema): moving / parked cars and motorbikes, moving / still people.
  - `effectsCompatibleTogether` (only `vehicle_light_trails` × `god_rays` is incompatible, plus duplicates) and `selectedEffects(effects)` (primary, then compatible unique secondaries; no primary → nothing).
  - `validate.ts`: `validateEffects` → BLOCK issues for the selected effects whose status is `blocked`, path `shotIntent.effects.primary` / `shotIntent.effects.secondary[i]`, params `{ effectId, reason }`. Registered as `effectsRule` in `SHOT_RULES` (after object placement).
- **Rules (blocked → code)**
  - Light trails: no road → SOURCE_MISSING `no_road`; only parked vehicles → MOTION_CONFLICT `vehicles_parked` (AC-08); no vehicle at all → SOURCE_MISSING `no_moving_vehicle`; daytime → SOURCE_MISSING `needs_dark`. Conditional: road inferred, time unknown, golden hour / dawn.
  - People blur: only still people → MOTION_CONFLICT; no people → conditional.
  - Soft clouds: enclosed → SOURCE_MISSING `no_sky` (AC-09); conditional for detail camera / semi-outdoor.
  - Silky water: no water → SOURCE_MISSING; context-only mention → conditional.
  - Sunstar / lens flare: lamps on → available; night without lamps → `no_light_source`; overcast without lamps → `sun_hidden`; interior by day → conditional through a window.
  - Light rays: dusk / night → `needs_sunlight`; interior with `daylightDirection: "none"` → `no_opening`; unknown opening / time → conditional.
  - Reflection control: never blocked (conditional indoors and for steep cameras).
- **ShotIntent**: `effects?: ShotEffects` in the TS type and `ShotIntentSchema`; Rust DTO `ShotIntent.effects: Option<ShotEffects>` with `ShotEffects`, `EffectChoice`, `EffectIntensity` (lowercase enum; an unknown intensity is rejected). `normalizeShotIntent` drops `effects` without a primary, so the snapshot and `sourceHash` are unchanged.
- **Compiler**: `prompt/sections/effects.ts` (`EFFECTS:` heading), section `effects` after `sceneObjects`, before `quality`. Lines: keep architecture static and sharp (exterior wording = SRS §6.2, interior variant), then per effect the apply sentence (conditional ones end "only where that source is present in the approved references.") and its guard, then "These effects describe the look only, not exact camera settings; never add a new source for an effect." Blocked effects are never compiled. No effect → no section, prompt byte-identical.
- **Desktop**
  - New module `effects` ("Hiệu ứng" / "Effects", icon `Aperture`) in the DNA group after Scene objects; `PropertyPanel` renders `features/effects/EffectsPanel.tsx`.
  - Eight cards: name (vi/en by locale), status badge, plain reason for blocked / conditional, "Chính" / "Phụ" toggles, an intensity range slider (Nhẹ / Vừa / Mạnh) once chosen, a preview with the exact prompt lines and "Tắt mọi hiệu ứng". Blocked effects cannot be chosen (a primary that became blocked can still be turned off, with an alert). Secondary buttons explain why they are disabled (no primary, already primary, incompatible, limit, blocked).
  - Writes only `workspace.shotIntent.effects` via `setShotIntent`; `setShotIntent`'s emptiness check now includes `hasEffects(shotIntent.effects)`. The gate (`validateShot`) enforces it on submit.
  - i18n `modules.effects` and `effects.*` (vi with full diacritics, en). CSS block "Optical and motion effects" at the end of `app.css`.

## Tests

- `packages/domain/tests/effects.test.ts` (20): catalog / labels / families, schema, secondary selection, matrix (AC-09, AC-08, trails road / vehicle / time, people, water, sunstar / flare, light rays, reflection control), validator paths and verdicts, compiler (versions, byte-identical without effects, SRS §6.2 lines and section order, blocked not compiled, conditional wording, intensity words, determinism).
- `apps/desktop/tests/effects.test.tsx` (8): AC-09 card disabled with reason, primary + slider stored in ShotIntent and not the DNA, compatible / incompatible secondaries, AC-08 card, English switch, gate BLOCK for AC-09 and AC-08 before any bridge submit, ALLOW submit snapshots `prompt.shotIntent.effects`.
- `apps/desktop/tests/units.test.ts`: module order / groups updated for `effects`.
- Rust `prompt_bundle_keeps_the_shot_intent_verbatim` now round-trips `effects` and rejects an unknown intensity.

Commands (worktree root, `CARGO_TARGET_DIR=F:/cargo-targets/srs-p2c`):
`npm run verify` (76 files / 923 vitest tests, Rust 307 passed / 6 ignored), `npx prettier --check .`; in `apps/desktop/src-tauri`: `cargo fmt --check`, `cargo clippy --offline --all-targets -- -D warnings` — all clean.

## Open / pitfalls

- `features/sceneObjects/SceneObjectsPanel.tsx` (out of scope for P2c) writes `setShotIntent(undefined)` when the last object is removed and no target space / detail is set, which also drops `effects` and `visualIntent`. A one-line fix there (`{ ...shotIntent, projectType, sceneObjects }` and let the store decide emptiness) is left for the lead.
- People blur without any person is `conditional` (it acts on people already in the references), while light trails without a moving vehicle is `blocked`, as the brief asks for a moving vehicle.
- Water and light detection from free text (context notes, weather / lighting presets) is a keyword heuristic and only makes an effect `conditional`, never available or blocked from guesses.
- Rust keeps `secondary` always serialised (`[]` when absent in the input); the desktop always writes the array, so the snapshot round-trips.
- Python / Windows text writes turned some LF files into CRLF during editing; they were converted back (prettier check is clean).
