# wt/srs-p1d

- Agent: claude (took over from a partial Codex commit `5551f35`)
- Task: `docs/agent-tasks/srs-p1d.md` (ADR-028, ADR-034 + amendments 1–2)
- Nothing is committed (lead's instruction).

## Goal

Wire Context Library V4 into the DNA (`context.library`), the compiler (`CONTEXT SUGGESTIONS`
section) and the context panel ("Gợi ý bối cảnh (thư viện V4)"), below site evidence.

## Review of the Codex partial work

- `schemas/context.ts` `ContextLibrarySelectionSchema`: kept (plus a doc comment).
- `compiler.ts` provenance (`contextLibraryVersion` in `configHash` input and `metadata`):
  kept, but now keyed on `usedContextLibrary(dna, projectType)` instead of the raw field, so a
  stale preset id or an interior project does not change the config hash.
- `sections/contextSuggestions.ts`: rewritten. Problems found:
  - `suggestContext` throws on an unknown preset/region, so a DNA saved with a preset that a
    later library version drops would have broken every compile.
  - The project type was not passed, so the site sides could differ from `SITE & OCCLUSION`
    (villa projects default lateral sides to open via `resolveSiteTopology`).
  - Interior projects would also have received exterior context cues.

## Done

1. **Schema** — `context.library?: { version: 1, presetId, regionId, approvedOptional[] }`
   (`approvedOptional` defaults to `[]`, `regionId` may be `"unspecified"`).
   `npm run schema:export` regenerated `packages/domain/schema/project-dna.schema.json`.
   The shared fixture `packages/domain/test-vectors/dna-v1-extensions.json` now carries a
   `context.library`, so the existing TS round-trip, the Rust validation tests and the Rust
   SQLite round-trip (`dna.rs::legacy_and_extended_dna_round_trip_unchanged`, which now also
   asserts the field) cover it. New Rust test `validates_context_library_selection`
   (accepts, rejects bad version / empty preset / non-string cue / unknown key).
2. **Evidence rules** (`contextLibrary/suggest.ts`, merged code, fixed):
   - Party-wall cues were dropped whenever *any* side was a street — the front is always a
     street, so "continuous party-wall neighbors" was dropped even on a fully attached
     townhouse. Now only an exposable lateral side contradicts it.
   - "one attached neighbor…" matched the party-wall regex and was dropped on a one-side
     site; it now has its own rule (contradicted when both lateral sides are attached or both
     exposable).
   - Added: "four exposed elevations" / "fully detached" with the lawn/grounds rule;
     corner cues ("two street-facing elevations", "two street edges", "intersection") are
     dropped when no lateral side is a street and one is attached; a *forbidden* cue that
     forbids party walls ("attached party walls") is dropped when a side is attached (it
     would contradict "keep the party walls attached" in `SITE & OCCLUSION`); region details
     go through the same cue check.
   - Optional 4th parameter `projectType` so sides resolve exactly as in the compiler.
3. **Compiler** — `COMPILER_VERSION` stays `pc-1.8.0`. Section `contextSuggestions` is placed
   last before `quality` (lowest priority). Heading states that site evidence, the master and
   the site/occlusion rules win; required cues: "Include only when consistent with verified
   site evidence: …"; optional cues only when in `approvedOptional`; region details / avoids;
   "Do not introduce: …" for forbidden cues. `droppedForEvidence` never appears. Absent for
   interiors, without the field, or with an unknown preset (unknown region → unspecified).
4. **UI** — `apps/desktop/src/features/contextLibrary/ContextLibraryPanel.tsx`, mounted in
   `ContextDnaPanel` right after the site adjacency editor (exterior projects only, like the
   site editor). Building-type filter (default: `spaceCatalog.buildingArchetype`, else
   `suggestArchetype`, else townhouse; not stored), preset picker via `contextSuggestionsFor`
   (empty = remove the field), region picker, optional cue checkboxes (stored in library
   order), required / forbidden / region lists, dropped list with "mâu thuẫn với dữ liệu khu
   đất", evidence-wins note. Disabled when read-only or `locks.context`. i18n `contextLibrary.*`
   in vi (full diacritics) and en. Small CSS block `.context-library*` in `app.css`.

## Tests

- `packages/domain/tests/context-suggestions.test.ts` (9): schema optional / round-trip /
  defaults; exact section text; determinism; attached townhouse + `villa.detached` and
  `hotel.retreat` (cues dropped, `SITE & OCCLUSION` still present); party-wall kept on fully
  attached site, one-side and corner rules; output unchanged without the library (positive
  minus the paragraph, negative, references, preservation identical); interior and stale preset.
- `apps/desktop/tests/contextLibraryPanel.test.tsx` (5): panel in context panel + archetype
  filter, writes/persists `context.library` and the compiler uses it, dropped list, read-only
  and lock, Vietnamese labels.
- Rust: `validates_context_library_selection` + extended round-trip assertion.

Commands: `npm run verify`, `npx prettier --check .`; in `apps/desktop/src-tauri`:
`cargo fmt --check`, `cargo clippy --offline --all-targets -- -D warnings`, `cargo test --offline`
(set `CARGO_TARGET_DIR=F:/cargo-targets/srs-p1d`, disk D is nearly full).

## Open / limitations

- Cue texts are shown in English in both locales (they are the prompt text; the library has
  no Vietnamese cue strings). Preset, region and building-type names are localized.
- Evidence rules are regex heuristics over the 53 in-scope presets; new library cues need a
  rule review. An `unknown` side never contradicts anything.
- `approvedOptional` entries that the evidence later drops are kept in the DNA but never
  compiled; the checkbox disappears with them.
- `COMPILER_VERSION` is `pc-1.8.0` like the other P2 branches; the lead resolves the conflict.
