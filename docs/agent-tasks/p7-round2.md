# Phase 7 — round 2 fixes on `wt/p7-integrate`

Branch: `wt/p7-integrate` (worktree `D:\worktrees\IMAGE-CREATIVE-ARCHITECT\p7-integrate`). It already contains:
- the three Phase 7 branches
- the partial integration (`d118ab0`)
- a merge of the current `main` (`f6e0f07`). The compiler is `pc-1.3.0` and keeps main's master-priority lines.

Read `docs/agent-reviews/p7.md` (round 1), `tasks/PHASE_07.md`, ADR-025 and API §16.

## Must fix (all of round 1 "PHẢI SỬA", plus the red verify)

1. **Lint.** `apps/desktop/src/lib/bridge.ts`: `RegionSaveRequestSchema` is only used as a type, and `RegionDTO` is unused. Fix the imports.
2. **One feather algorithm**, identical in TS (`packages/domain/src/regions/mask.ts`) and Rust (`src-tauri/src/services/regions/mask.rs`). Use:
   - three passes of a 2D box blur with window `(2r+1)²`
   - samples outside the image are excluded, and the average is taken over the in-image count
   - integer rounding `round-half-up` after each pass

   Update the spec text in API §16.1 (`docs/API_CONTRACTS.md`), regenerate `packages/domain/test-vectors/masks.json`, and make Rust match exactly. The feather tolerance is ±1, but aim for exact.
3. **Shape validation agreed on both sides.**
   - Rectangles: `w > 0` and `h > 0`, and the rectangle stays within 0..1.
   - Brush: `0 < radius ≤ 1`.
   - Polygon: at least 3 points; all coordinates finite and within 0..1.
4. **Archived check.** `region_list` calls `ensure_not_archived`, as do save and delete.
5. **Composite never skipped.** If the source cannot be decoded for compositing, the generation fails with a clear error. It never stores the uncomposited provider output.
6. **UI mask preview** draws the actual `rasterizeMask` bytes, for example to an offscreen canvas turned into an image with a translucent tint. It must not paint a full overlay.
7. **Hit-testing matches the shape.**
   - rectangle: its box
   - polygon: even-odd point-in-polygon
   - brush: within the radius of any stroke segment
8. **Unlinking a scene object** ("Không có") sets `objectId: null`. Do not use `?? old`.
9. **New scene objects** omit `material` when it is empty, or the schema accepts an empty value consistently. Autosave must pass.
10. **Vietnamese strings** in `i18n/vi.ts` for the module use proper diacritics, for example "Chỉnh vùng", "Chạy chỉnh vùng", "Kết quả chỉnh vùng". The guard test must catch unaccented Vietnamese for these keys.

## Also

- Add `docs/agent-notes/p7-integrate.md`: what was integrated, the stand-ins removed, the test commands, and the pitfalls.
- Leave `docs/agent-tasks/**` unchanged.

## Done when

- `npm run verify` is green.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `npx prettier --check .` are clean.
- The TS and Rust mask vectors match.
