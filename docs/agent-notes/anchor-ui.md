# wt/anchor-ui

- Agent: Codex
- Branch: `wt/anchor-ui`
- No commit made, per task instructions.

## Completed

Implemented the ADR-028 UI slice: the `siteTopology` stand-in and helpers, exterior lot-position card with inferred hints and corner-side guards, camera and batch topology chips with one-click unknown-side resolution, overview lot summary, EN/VI strings, and DNA update preservation for the additive key.

## Stand-ins

- `apps/desktop/src/lib/siteTopology.ts` owns the §19.1 types and §19.2 helpers, marked `TODO(anchor-domain)`.
- The integrator should replace it with `@arch/domain` exports when `wt/anchor-domain` lands; the additive preservation cast in `apps/desktop/src/app/store.ts` can then be removed.

## Tests and verification

- Added `apps/desktop/tests/anchorTopology.test.tsx` for inference, explicit edits, corner-side disabling, camera resolution, batch unresolved warnings, and interior exclusion.
- Root `npm run verify`: passed; JavaScript `42` files / `503` tests and Rust `267` passed / `6` ignored.
- Desktop TypeScript and ESLint passed as part of verify.
- `npx.cmd prettier --check .`: passed (PowerShell policy blocks the `npx.ps1` shim).

## Caveat

The current domain schema/mock backend may strip `context.siteTopology` after persistence; tests assert the store draft and outgoing `dna_update` shape as required by the brief.

