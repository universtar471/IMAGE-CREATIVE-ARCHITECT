# Upgrade plan: Master Specification V7.2 (SRS 1.0) on top of the current codebase

Date: 2026-10-15. Input: the user's handoff package `IMAGE_CREATIVE_ARCHITECT_AI_HANDOFF` (14 identical ZIP copies in Downloads; the path `D:\AI_PROJECTS\...` named in the handoff does not exist on this PC). Contents read:

- `00_START_HERE` (prompt, README, version status, manifest)
- `01_MASTER_SPEC` V7.2 (identical to `docs/specs/MASTER_SPEC_SRS_1_0.md`, sha256 `c3536bee…`)
- `02_LIBRARIES_V3_V4`: Building Space Catalog V3 and Architectural Context Library V4
- `03`/`04` Color Grading V5.2/V5.3: the V5.3 full source is identical to the ZIP already merged in ADR-032 (sha256 `d6832006…`)
- `05` original repository
- `06` diagram reference video

## 1. Which code is the base

The handoff asks to use the **V5.3 full source** as the base. That snapshot is `35f11c9` (GitHub `origin/main`) plus the V5.2/V5.3 patch. It was never typechecked or tested.

The local `main` already contains **all of V5.3**: it was merged in ADR-032, with about ten bugs in the supplied code fixed. Main also contains the following work, which the V5.3 snapshot lacks:

| Already on main, missing from the V5.3 snapshot | ADR |
|---|---|
| Interior DNA (15 styles, rooms, material slots, interior camera) | 027 |
| Master-consistent anchors, `context.siteTopology`, `cameraSitePlan` | 028 |
| UX round 2, preview photos | 029 |
| AI DNA assist, Space panel, 48 preset photos | 030 |
| Colour grade v2 on LightCraft, 5 style presets, user LUT library | 031 |
| V5.2/V5.3 merged and fixed | 032 |
| Vision QC removed at the user's request | 033 |
| SRS P0–P1 plan (in progress on `wt/srs-p0`) | 034 |

**Decision:** keep working on `main` (= V5.3 + the above). Starting again from the V5.3 ZIP would discard ADR-027…034, so the V5.3 snapshot is used only as a reference. The baseline is green: `npm run verify` passes on main (575 JS tests plus the Rust suite).

## 2. SRS V7.2 versus the code

Legend: ✅ done · 🟡 partial · ❌ missing · 🔧 needs fixing

### Shared foundation

| SRS item | Status | Evidence / notes |
|---|---|---|
| Project DNA v1 extensible with optional extensions | 🟡 | `ProjectDNASchema` (`schemaVersion: 1`) already takes optional `interior`, `scene`, `colorGrade` v2. Missing: `spaceCatalog`, `site`, `architecturalDetails`, `EvidenceRef` (P0, in progress). |
| Evidence status verified / inferred / unknown / user_declared | ❌ | P0, in progress. |
| Unified Conflict Validator (BLOCK/WARN/ALLOW, §12.4 codes) | ❌ | Only scattered checks exist: DNA validation, spend confirm, workflow gating. P0, in progress. |
| Prompt compiler: stable sections, version, byte-identical | 🟡 | `pc-1.6.0` with fixed section order and a determinism test. Missing: `TASK & TARGET`, `SPACE SCOPE`, `SITE & OCCLUSION` sections, `sourceHash`/`configHash`, validator version, conflict gate. |
| Extra prompt validated before append | ❌ | `withExtraPrompt` appends raw text. P0. |
| Snapshot per generation | 🟡 | The generation request is stored with params, but has no shot intent or verdict. |
| Feature flags for unfinished modules | ✅ | `modules.ts` `availableIn` (export = 9). |

### Modules

| Module | Status | What exists | Gap |
|---|---|---|---|
| **A. Space Catalog V3** | 🟡 | Interior DNA (ADR-027): rooms, 15 styles, material slots. The V3 package (256 presets) is available as an unmerged kit. | Schema extension, loader, registry, resolver, wizard UI and `SPACE SCOPE` section. 🔧 104 of 256 `labelEn` values are unaccented Vietnamese ("phong khach rieng") and appear inside `englishPrompt`, so they must be curated before use. 🔧 `knowledge/interior/{default,living_room}` defaults to "residential apartment" 5×6×3 m. |
| **A'. Context Library V4** | ❌ | 131 presets and 12 regions are in the kit, not merged. Main has ADR-028 context packs per project type. | 🔧 Its English prompts contain Vietnamese ("Depict a Nhà phố"). It must be a suggestion layer that never overrides site evidence. |
| **B1. Site adjacency / visibility** | 🟡 | `siteTopology` left/right attached/open/unknown, corner lot, `cameraSitePlan` modes, party-wall prompt text (ADR-028). | Four sides with evidence, the viewer-facing convention, `resolveVisibility` returning visible and occluded facades and confidence, a UI editor, and validator codes. |
| **B2. Simple camera (purpose / angle)** | 🟡 | `CameraPanel` presets, `CameraDirector` (expert), anchor views. | Visual intent selector with the Simple / Custom / Expert levels. |
| **B3. Detail shots** | ❌ | — | `ArchitecturalDetailRegistry` and `DetailShotPlanner` (only the schema arrives in P0). |
| **C. Optical & motion effects** | ❌ | Weather, lighting and mood presets only. | Effects catalog, compatibility matrix, prompt section. |
| **D. Scene objects & cars** | 🟡 | `scene` DNA has a free-text people/vehicles intent. | Object catalog, per-space rules, placement validator, named classic-car presets. |
| **E. Render enhancement** | 🟡 | Enhance conservative/generative, batch, region masks, `mask.rs` composite. | strict / balanced / creative modes and geometry/material/context/camera locks. 🔧 The SRS QC relies on Vision QC, which was removed (ADR-033): replace it with free local checks (size, registration, SSIM on locked regions) or skip. |
| **F. Upscale 2K/4K & router** | 🟡 | `local_upscale.rs` Lanczos3 + unsharp, `targetLongEdge`. | `long_edge_2048`/`4096`, UHD contain, no-downscale policy, provider capabilities (API / ComfyUI), batch cost and retry. |
| **V5.2/V5.3 colour grading** | ✅ | 30 looks, gallery, batch dialog, plus v2 / LightCraft / LUT on top. | Real-Tauri test by the user is still pending. |
| **G. Diagram Studio V6** | ❌ | — | The reference video `06_REFERENCE/2712.mp4` is available. |
| **H. Publishing Studio V7.2** | ❌ | `export` module placeholder (`availableIn: 9`). | Everything: page budget, styles, layout, editorial text with fact refs, PDF/PNG. |

## 3. Rules that keep modules from conflicting

1. **One owner per data section.** Each section has exactly one module that may write it:
   - `building`, `context`, `interior`: DNA panels
   - `spaceCatalog`: space wizard
   - `site`: site editor (it also mirrors `context.siteTopology` for older code)
   - `architecturalDetails`: detail registry
   - `cameras`: camera
   - `scene`: objects
   - `colorGrade`: mood/grade

   Shot-level choices (`targetSpaceId`, camera intent, detail, objects, effects, output) live in a **ShotIntent snapshot**. They never write back into DNA.
2. **One validator.** Every module registers rules in `packages/domain/src/validation/`, using the §12.4 codes. No module ships its own blocking logic. The desktop gate before each paid call uses `validateShot`.
3. **One compiler, section-owned.** Each module contributes one named section to the compiler and does not concatenate strings. Free text passes through the validator.
4. **Independent versions.**
   - `ProjectDNA.schemaVersion` stays 1, and each extension has its own `version`.
   - `COMPILER_VERSION` (`pc-x`), `VALIDATOR_VERSION` (`cv-x`), `CATALOG_VERSION` (`sc-x`) and the context library version are separate.
   - Feature names (V3…V7.2) are never used as version numbers.
5. **Priority order (SRS §3.3) is implemented once.** It lives in the validator: hard locks > verified evidence > openings and visibility > target space > physical fit > suggestions > decoration. Context Library V4 and style presets sit at the bottom and never override site evidence.
6. **Feature flags.** A module appears in navigation only when its UI is complete (`availableIn`).
7. **Commands.** New Rust commands keep the `blocking()` pattern. Request DTOs are mirrored in TS contract fixtures (`contract_fixtures.rs` ↔ `backendContract.test.ts`).
8. **No hidden data loss.** Removed features keep their tables and labels (as with ADR-033 QC).

## 4. Compatibility with old projects

- Extensions are optional and parse to `undefined` when absent. Defaults are only added where they already existed.
- **Roundtrip tests (AC-20):** an old DNA fixture goes through parse → save → reopen in TS and Rust (via the generated JSON schema in `dna_validation.rs`), with nothing lost and no extension invented.
- `siteTopology` remains readable. `resolveSiteAdjacency` derives the four sides from it when `site` is absent, and the site editor writes both.
- Interior DNA (ADR-027) stays. When `spaceCatalog.activeSpaceId` points to an interior space, the interior room and style continue to drive styling. A mapping table links interior room ids to V3 preset ids.
- `ProjectTypeSchema` is unchanged. `buildingArchetype` is a separate field, with a suggested default per project type.
- Colour grade: the v1 looks and the v1 pixel path are unchanged. The v2 fields are optional (ADR-031).
- No migration drops tables or rewrites stored DNA. Every new table gets an additive migration.
- Before each merge, the lead runs: `npm run verify`, `cargo fmt/clippy`, prettier, compiling the user's real DNA with `npx tsx` (the lesson from ADR-028), and a backup of `studio.db` before the user upgrades.

## 5. Implementation order (dependency-driven)

| Phase | Work | Key files | Acceptance |
|---|---|---|---|
| **P0** (in progress, `wt/srs-p0`) | EvidenceRef; extensions `spaceCatalog`, `site`, `architecturalDetails`; `resolveSiteAdjacency`; validator (`cv-1.0.0`, §12.4 codes, the adjacent-building, unverified-geometry and locked-lighting rules); PromptBundle hashes; desktop gate; Rust refusal of BLOCK snapshots | `packages/domain/src/{facts,site,validation}/`, `schemas/projectDna.ts`, `prompt/compiler.ts`, `features/generate/*`, `services/generations.rs` | AC-20, AC-21, AC-22 |
| **P1a** Space Catalog | Import V3 (256 presets) through a converter; curate `labelEn` and `englishPrompt` (104 records); registry, resolver, mapping table to interior rooms; wizard (archetype → floor → group → space → variant, evidence badges); `SPACE SCOPE` section; fix the 5×6×3 m defaults | `packages/domain/src/spaceCatalog/`, `knowledge/space-catalog/catalog.json`, `features/space/SpaceSelector.tsx` | AC-01, AC-02 |
| **P1b** Site & visibility | `resolveVisibility`; four-side site editor with evidence; `SITE & OCCLUSION` section replacing the party-wall text; `describeCamera` never promises occluded facades; Context Library V4 as a curated, evidence-subordinate suggestion layer; compiler `pc-1.7.0` | `packages/domain/src/site/`, `prompt/compiler.ts`, `camera/describe.ts`, `features/context/*` | AC-03, AC-04, SRS §5.4 tests |
| P2 | Simple camera (intent selector), detail registry and planner, effects plus compatibility matrix, scene objects plus car library | `features/camera/VisualIntentSelector.tsx`, `domain/{detail,effects,sceneObjects}/` | AC-05 … AC-09 |
| P3 | Enhance strict / balanced / creative with lock composite and local QC (no Vision QC); upscale 2K/4K targets, no-downscale policy, provider capabilities | `generation/enhance.ts`, `features/enhance/*`, `local_upscale.rs`, `regions/mask.rs` | AC-10 … AC-13 |
| P4 | Diagram Studio (planner, fixed isometric, SVG labels, FFmpeg video) | `domain/diagram/`, `features/diagram/`, `services/diagram_export.rs` | AC-14, AC-15 |
| P5 | Publishing Studio (exact page budget, 16 styles, seeded layout, page locks, fact-referenced captions, PDF/PNG) | `domain/publishing/`, `features/publishing/`, `services/publication_export.rs` | AC-16 … AC-19 |
| P6 | Optional ComfyUI provider, brand kit, flipbook, advanced video | — | after the MVP is stable |

P1a and P1b run in parallel after P0 merges: they touch separate folders, and the compiler sections are owned per rule 3. P2 waits for P1 because objects, effects and details are validated against the space and the site.

## 6. Decisions the user needs to make

1. **QC for enhance (P3):** Vision QC was removed. Use free local checks only (recommended), or skip QC for enhance.
2. **Catalog curation:** the lead rewrites the 104 unaccented English labels and prompts. Specialist rooms (healthcare, education) need the user's review before production use, as the SRS notes.
3. **Push:** main is far ahead of `origin/main` (`35f11c9`). Pushing needs explicit approval.

## 7. Known risks

- Prompts cannot guarantee geometry; the masks, composite and local checks in P3 are the real safeguard (SRS §18.1).
- Visibility without heights or setbacks stays conservative: it warns and never promises.
- Disk D is at about 89%. Each worktree's `target/` is 7–14 GB, so clean merged worktrees promptly.
- HHTECH credit runs out often. Claude subagents are the fallback coders.
