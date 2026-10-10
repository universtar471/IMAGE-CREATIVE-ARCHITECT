# Master-consistent anchors — UI (ADR-028, API §19.5)

**Branch:** `wt/anchor-ui`. You own `apps/desktop/src/**` and `apps/desktop/tests/**`, except `tests/fixtures/backend`.

## Domain stand-ins

The schema and helpers are being built in parallel on `wt/anchor-domain`. Until they land:
- Create `apps/desktop/src/lib/siteTopology.ts` with the exact §19.1 types and the §19.2 helper signatures and behaviour: `resolveSiteTopology`, `revealedSide`, `cameraSitePlan`.
- Mark everything `TODO(anchor-domain)`.

The integrator will swap the file for `@arch/domain` exports, so keep all imports going through that one file. Write `siteTopology` into `dna.context` through the normal DNA update and autosave path. The current domain schema may strip the unknown key until the swap. Write the tests against the store and update call, not against the persisted parse.

## Read first

- ADR-028 and API §19.
- `features/dna/ContextDnaPanel.tsx`
- `features/camera/*`
- `features/generate/BatchDialog.tsx`
- `components/common/SpendConfirm`
- `features/workflow/*`
- `i18n/{vi,en}.ts`
- The interior variants added by ADR-027: interior projects show no topology UI.

## Scope

1. **Bối cảnh step:** a "Vị trí lô đất" card, exterior projects only.
   - Trái and Phải: a segmented control with Liền kề / Trống / Chưa rõ.
   - Lô góc: a checkbox. When it is checked, a side select appears, with only the non-attached sides enabled.
   - Inferred values show the hint "(tự nhận từ mô tả)". Any user edit writes explicit values.
2. **Camera step:** a chip on each camera card, from `cameraSitePlan`, using the §19.5 wording.
   - `unknown_side` is a warning chip with the buttons [Liền kề] and [Lô góc].
     - Liền kề sets that side to `attached`.
     - Lô góc sets `cornerLot` to true, `cornerSide` to that side, and the side to `open`.
   - The buttons write and autosave.
3. **Anchor and batch dialog**
   - The same chips per selected camera.
   - Unresolved `unknown_side` cameras are listed above the spend confirm, with the same buttons. They do not block.
4. **Overview:** the DNA summary shows the lot position in one line, for example "Lô giữa dãy · liền kề 2 bên" or "Lô góc · trái".
5. **Strings:** vi with proper diacritics, and en. Keep i18n parity and the diacritics guard.
6. **Tests**
   - The card writes explicit values, and the inferred hint shows when the values are inferred.
   - The corner side select disables attached sides.
   - Each chip mode renders on the camera cards.
   - The unknown-side buttons write the right `siteTopology`.
   - The batch dialog lists unresolved cameras without blocking.
   - Interior projects show no topology UI.
   - Non-affected exterior projects are unchanged.

## Done when

- `npm run verify` is green.
- `npx prettier --check .` is clean.
- `docs/agent-notes/anchor-ui.md` is written and lists the stand-ins.
