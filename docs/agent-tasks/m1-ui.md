# M1 — Preset grid and chips (A2 + A3), ADR-039

**Branch:** `wt/m1-ui`. You own `apps/desktop/src/features/presets/**`, the effects, sceneObjects and camera panels, and their tests.

## Read first

- ADR-039
- `packages/domain/src/presets/*`
- `features/generate/GeneratePanel.tsx`
- `features/generate/GeneratePromptPreview.tsx`
- `app/store.ts` (`setShotIntent`)
- `i18n/{vi,en}.ts`

## Scope

1. **`PresetGrid`.** Groups follow `PRESET_GROUPS`, with the presets of `presetsForShot(presetShotIsInterior(dna, projectType))`. A selected preset renders as an active chip.
2. **Click.**
   - Run `togglePreset`, then `setShotPresets(shot, ids, dna)`, then `setShotIntent`.
   - When `skipped` is not empty, show a one-line hint naming the skipped presets.
3. **`PresetChips`.** A row of the selected chips with ×. The look chip says it is free and applied after generation.
4. **Prompt Preview.** Under the PRESETS section, list `metadata.presetSources` next to each line, translated by preset label.
5. **A3.**
   - Effects, Scene objects and Visual intent stay as they are, under an "Advanced" disclosure inside the Studio panel.
   - They keep editing the same ShotIntent fields, so a chip and a manual edit show the same state.
6. **Strings.** Labels come from the preset (`labelVi` / `labelEn`). Only the UI chrome goes in i18n, and diacritics are required.
7. **Tests.**
   - Toggling replaces exclusive peers.
   - Chips survive a reload through the stored shot intent.
   - Interior projects hide exterior-only presets.
   - `hardcodedStrings` passes.
