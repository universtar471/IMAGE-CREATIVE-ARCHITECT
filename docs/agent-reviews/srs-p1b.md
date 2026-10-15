# Review: wt/srs-p1b (ADR-034 P1b)

**Verdict: ĐẠT. Merged.**

## Round 1 (Claude subagent)

- PHẢI SỬA: for villa, resort and other detached projects whose sides were not declared, the corner camera lost its "three-quarter" wording. This was a regression from pc-1.6.0.

## Round 2 (Codex via Volibear)

**Fix**
- `resolveSiteTopology(context, projectType)`: for `villa`, `single_storey_house` and `prefab_modular`, an undeclared side now resolves to `open` with source `default`. The evidence is `inferred`, never user-declared.
- `townhouse`, `urban_villa` and `custom` still resolve undeclared sides to `unknown`.
- Explicit values, and attached sides inferred from the neighbour notes, still take priority.
- Validator bumped to `cv-1.1.0`.

**Lead verification**
- After `main` was merged in: vitest 65 files, 742 tests pass.
- Typecheck, lint and prettier are clean.
- Under heavy machine load (four agents running), one test failed once and passed on rerun.

## NÊN SỬA (later)

- `heightRelation` cannot be edited in the UI.
- The negative prompt and the camera chip still read `siteTopology` rather than `site`.
