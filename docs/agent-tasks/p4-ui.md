# P4-C — UI: Lighting module, Mood/Grade module, locks, grade preview, mood variations

Branch `wt/p4-ui` (from main).

Read first:
- `tasks/PHASE_04.md`
- ADR-007, ADR-008, ADR-019…021
- `docs/API_CONTRACTS.md` §12
- `docs/UI_UX_SPEC.md`
- `apps/desktop/src/**`: workspace modules, the camera feature (as a pattern), generate, batch dialogs, Contact Sheet, `i18n/`, `mockBackend.ts`

You own `apps/desktop/src/**` and `apps/desktop/tests/**` except `tests/fixtures/backend`.

## Domain helpers from P4-A

P4-A builds these in parallel:
- presets
- `compileWithOverrides`
- `buildMoodVariationItems`
- `adoptMoodPreset`
- the grade math and `GRADE_LOOKS`
- the light id helper

If you need one before it lands, write a minimal stand-in in `apps/desktop/src/lib/` with the signature from `docs/agent-tasks/p4-domain.md` and API §12, and mark it `TODO(p4-domain)`. Write the grade-math stand-in exactly per §12.3 so the preview is correct.

## Scope

1. **Modules and strings**
   - Enable "Lighting" and "Mood / Grade" in `features/workspace/modules.ts`.
   - Add every new string to BOTH the `en` and `vi` dictionaries, in natural Vietnamese (Ánh sáng, Thời tiết, Không khí / Mood, Chỉnh màu, Khoá).

2. **Lighting module** (right panel + canvas)
   - **Lighting**: time-of-day select, sun direction and elevation, intensity, shadow length and softness, ambient, and a lighting preset picker from the pack.
   - **Artificial lights list**: add, remove, enable toggle, zone select, colour temperature slider (2200–6500 K), intensity.
   - **Weather**: presets plus sky, humidity, ground wetness, haze and notes.
   - A lock toggle on each section.
   - Changes autosave through the existing DNA autosave and show up in the prompt preview.

3. **Mood / Grade module**
   - **Mood**: presets plus fields, and a lock.
   - **Color grade controls**:
     - sliders as in `ColorGradeDNA`
     - a look picker that fills the sliders
     - reset
   - **Live preview** on the canvas for the selected image:
     - draw it to a canvas downscaled to ≤1600 px on the long edge, then apply the grade math
     - before/after toggle and a split slider
     - keep slider drags responsive with a Web Worker or chunked processing
   - **Grade actions**:
     - "Apply grade" calls `grade_apply` on the selected asset, then selects the new asset.
     - "Save as project grade" writes `dna.colorGrade`.
     - The colour-grade lock prevents edits.
   - **Mood variations dialog**:
     - Source is the master or the selected output.
     - Pick 2–8 presets (lighting / weather / mood combinations); locked dimensions are disabled.
     - Provider, model and params as in the existing batch dialogs, with the HHTECH cost hint.
     - Build the items with `buildMoodVariationItems`, then call `batch_create`.
     - Results appear on the Contact Sheet grouped by preset label.
     - "Adopt this mood" calls `adoptMoodPreset`, then the DNA autosaves.

4. **Mock backend**
   - Implement `grade_apply` with the same TS grade math.
   - Add the presets.

5. **Tests**
   - grade preview wiring
   - locked sections are read-only
   - applying and merging presets
   - mood-variation item building
   - adopting a mood
   - mock `grade_apply` creates a new asset and version and leaves the source unchanged
   - i18n keys exist in both languages

## Done when

- `npm run verify` is green.
- Checked in the browser preview (mock backend, port 1421) in both languages, if browser tools are available.
- `docs/agent-notes/p4-ui.md` is written and lists the stand-ins to swap at merge.
