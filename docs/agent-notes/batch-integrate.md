# Batch integration: Phase 7 + sketch mode + UX guidance

## Integrated

- Combined Phase 7 region editing, ADR-026 sketch/massing Hero mode, and the UX guidance work (next-step bar, spend confirmation, single-anchor rerun, and lock explanations).
- Kept compiler version `pc-1.3.0` for both Phase 7 pinned scene objects and `structure_sketch`; API contract section 17.2 now states that version explicitly.

## Review fixes

- Region edits now calculate `maskCoveragePct` from the unfeathered union mask at source dimensions, round it to one decimal percent, and persist it with `nativeMask` in operation/output metadata. The mock backend mirrors this, and region prompt metadata carries both fields.
- All paid retry entry points now use the shared `useSpendConfirm()` flow: latest result, History, Contact Sheet, and Jobs. Region edit submits use it too; local providers retain the existing bypass.
- Verified sketch Hero submits use `GeneratePanel`'s shared paid-submit confirmation.
- The next-step bar remains visible on the `regions` module, and region gating renders the `generate.master` lock explainer.
- Brush strokes require at least one point in both Zod and Rust validation.
- Added a direct mock `asset_import` test proving `structure_sketch` is stored unchanged.

## Tests added or extended

- Known-mask coverage and rounding in TypeScript, Rust, persisted Rust operation metadata, and mock output metadata.
- Paid retry entry-point guards, paid failed-generation cancellation, and paid sketch Hero submission.
- `regions` next-step bar visibility and region lock explanation coverage.
- Empty brush-stroke rejection on both sides.
- Mock import round-trip for the `structure_sketch` role.

## Verification

- `npm.cmd run verify`: 39 Vitest files / 471 tests passed; Rust 264 passed / 6 ignored live paid tests.
- `cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `cargo clippy --all-targets --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings`
- `npx.cmd prettier --check .`

## Pitfalls

- Retry jobs expose provider/model but not output-count pricing directly, so Jobs resolves the source generation before opening spend confirmation.
- The mock asset DTO does not expose operation metadata through the public bridge schema; mock parity is asserted against its persisted in-memory asset record.
- No live provider or other paid API calls were made; the six live Rust tests remained ignored.
