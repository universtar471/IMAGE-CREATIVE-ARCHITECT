# P6-A — Domain: QC schemas, scoring, vision prompt and parser, repair prompt

Branch `wt/p6-domain`. You own `packages/domain/**` only.

Read first:
- `tasks/PHASE_06.md`, ADR-024, API §15
- `packages/domain/src/` for style: `schemas/generation.ts`, `prompt/compiler.ts`, the Phase 5 enhance code, `workflow/`

## Scope

1. **Schemas in `packages/domain/src/qc/`**, exactly as §15.1.
   - Include `QcSettingsSchema` with defaults and `defaultQcSettings()`.
   - Include the request schemas for the four commands.
   - `GenerationPurposeSchema` gains `"repair"`.
   - `params.repair = { qcReportId }` is required when the purpose is `repair`.
   - Re-export the JSON Schema if the script runs. If it hits the known `uv_os_get_passwd` sandbox error, say so in the note.
2. **`scoreReport(local, vision, thresholds)`** follows the ADR-024 rules exactly. Tests cover:
   - every branch, including `unscored`, the warn band and a high artifact
   - a vision-less run with and without `edgeAlignment`
3. **`parseVisionReply(text)`**
   - Extract the first balanced JSON object, even from inside code fences or prose.
   - Validate it, clamp and round scores to 0..100, and clamp boxes to 0..1.
   - Unknown severities or categories are an error.
   - Throw `Error("Vision reply is not valid QC JSON: …")`.
   - Test with clean, fenced, chatty, truncated and invalid inputs.
4. **`buildVisionPrompt({ dna, purpose })`** returns `{ system, user }`. Deterministic, in English.
   - Describe the five categories.
   - Pass the building / context facts from the DNA so the judge can check them.
   - Include the same-view note when the purpose is enhance / variation / repair.
   - Demand JSON only, with the exact keys.
   - Add snapshot tests.
5. **`buildRepairPrompt({ dna, report })`**: deterministic.
   - Fix only the listed issues and artifacts, plus the `repairInstruction`.
   - Keep the architecture, camera, composition and everything else unchanged.
   - Add snapshot tests.
6. **Gating.** `isGenerationAllowed("repair", …)` behaves like `variation`.
7. **Constants.** Export `QC_CATEGORIES` and `QC_SAME_VIEW_PURPOSES`.

## Done when

- `npm run verify` is green.
  - If only the desktop app fails because it lacks the new purpose or strings (outside your scope), say so in the note.
  - Do not edit `apps/**`.
- `docs/agent-notes/p6-domain.md` is written, with the exported names and their signatures.
