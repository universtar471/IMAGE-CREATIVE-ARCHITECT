# Architectural Context Library V4

**131 presets** across **15 building groups**, plus **12 regional overlays**.

Files: `presets.json` (Vietnamese descriptions, English prompts, required/optional/forbidden), `regions.json` (regional climate overlays), `schema.ts`, `resolver.ts`.

## Important constraints
- Presets are proposed V4 data, **not audited existing repository files**.
- `requiredIfSupported` are conditional scene cues, **not proof of real site features**. Verified site photos/surveys and locked DNA always win.
- `forbiddenByDefault` means do not invent; user-confirmed site facts can override a default exclusion.
- Region overlays are independent from building presets; they should never invent a location or override a verified site.
- The provided resolver composes prompts and checks schema-like basics; it **does not automatically detect semantic contradictions** or visually validate generated images. Add conflict detection and visual QA in production.
- English prompts are individually specialized by preset; they are generated from distinct context facts plus a shared safety/realism policy.

## Suggested compiler pipeline
`Building DNA -> Site evidence -> Preset selection -> Region overlay -> Conflict validation -> Prompt compilation -> Provider -> Visual QC`

## Sample
`townhouse.corner_lot` + `vn_south_urban` + verified two street-facing elevations.

## Integration
Map the project's actual existing domain schema and imports before integration. Do not overwrite existing packages without repository-level tests.
