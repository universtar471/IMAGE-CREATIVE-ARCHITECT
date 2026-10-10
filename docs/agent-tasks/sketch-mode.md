# Sketch / massing to render (ADR-026, API §17)

Branch: `wt/sketch-mode`. This one task touches three areas:
- `packages/domain/**`
- `apps/desktop/src-tauri/**`
- `apps/desktop/src/**` and `apps/desktop/tests/**`

## Read first

- `docs/DECISIONS.md`: ADR-026; ADR-008 (reference order); ADR-022 (workflow gating).
- `docs/API_CONTRACTS.md` §17.
- Domain:
  - `packages/domain/src/schemas/enums.ts` (`AssetRoleSchema`)
  - `packages/domain/src/prompt/compiler.ts` (`REFERENCE_ROLE_ORDER`, `ROLE_INSTRUCTIONS`, `preservationSection`, master-priority lines from `pc-1.2.1`)
  - `packages/domain/src/generation/helpers.ts`
- Backend: `apps/desktop/src-tauri/src/domain.rs` (the `AssetRole` enum) and `src/providers/text.rs` (role labels).
- UI:
  - `apps/desktop/src/features/generate/{form.ts,GeneratePanel.tsx}`. `pinnedIds` already exists: variations pin the master. Reuse that mechanism.
  - Asset import (`features/assets`, the "Nhập với vai trò" select).
  - `i18n/{vi,en}.ts`: `labels.assetRole` and `labels.assetRoleShort`.

## Scope

1. **Domain**
   - Add the role `structure_sketch`. Place it right after `master_architecture` in `REFERENCE_ROLE_ORDER`. Exclude it from `DEFAULT_REFERENCE_ROLES`.
   - In the compiler, add the role instruction and the preservation line exactly as in §17.2, and bump `COMPILER_VERSION` to `pc-1.2.2`.
   - Tests:
     - ordering
     - default selection excludes the role
     - instruction text
     - the preservation line with and without a master
     - the master-priority lines still present
   - Re-export the JSON schema. If you hit the sandbox ENOMEM error, say so in the note; there is a drift test.
2. **Backend**
   - Add `StructureSketch` ↔ `"structure_sketch"` wherever roles are parsed or serialised.
   - Add the provider role label "structure sketch: keep geometry and viewpoint exactly, render with real materials".
   - Import and set-role must accept it.
   - Tests: a round-trip, and import with the role. Regenerate the contract fixtures if they change, with `UPDATE_BACKEND_FIXTURES=1 cargo test contract_fixtures`.
3. **UI**
   - Role labels in vi and en (with proper Vietnamese diacritics) and a badge tone.
   - In the Generate panel, add a source segmented control at the top of the Output section: "Nguồn ảnh: Từ mô tả DNA | Từ phác thảo / khối", with en equivalents.
     - The control is shown when the purpose is Hero.
     - Selecting sketch forces Hero.
   - In sketch mode:
     - Show a picker of ready `structure_sketch` assets as thumbnails. Default to the newest.
     - Add an inline "Nhập phác thảo" button. It imports files directly with the role `structure_sketch`, using the existing import path.
     - Pin the chosen sketch as image 1 (`pinnedIds`). Its checkbox is locked, with the hint "Ảnh phác thảo luôn là ảnh 1; AI giữ nguyên hình khối và góc nhìn".
     - The aspect ratio anchors on the sketch.
     - Disabled reasons:
       - no sketch asset: "Chưa có ảnh phác thảo — bấm Nhập phác thảo"
       - model without image-to-image
   - Add a short "Cách dùng" line: upload a SketchUp screenshot, massing view or hand sketch; the AI keeps the shape and renders materials and light from the DNA; good results can be used as the Master.
   - Mock backend: accept the role.
4. **Tests**
   - form derivation: the sketch is pinned, aspect from the sketch, disabled reasons
   - panel toggles
   - import with the role
   - i18n parity and the diacritics guard

## Done when

- `npm run verify` is green.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `npx prettier --check .` are clean.
- `docs/agent-notes/sketch-mode.md` is written.
