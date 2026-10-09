# wt/p5-integrate

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-10 03:49

## Muc tieu

Ghep Phase 5 domain/backend/UI theo ADR-023 va API_CONTRACTS SS14, sau do lam xanh toan bo
kiem tra tren nhanh tich hop.

## Da xong

- Bridge dung truc tiep `@arch/domain` cho cac schema generation/batch; da xoa cac lop
  compatibility cua Phase 5.
- UI enhance da bo stand-in schema/prompt/item builder: helper goi
  `EnhanceParamsSchema`, `buildEnhancePrompt`, `buildEnhanceItems`, `ENHANCE_TARGETS` va
  `MAX_ENHANCE_EDGE` tu domain. Prompt generative dung DNA da luu; conservative de trong
  prompt theo contract. Da bo cast `as never` quanh purpose `enhance` va them i18n en/vi.
- Mock registry khop provider Rust (`local_upscale` label `Local upscale`), enforce params bat
  buoc, mot reference, model reference capability, no-downsize/cap 8192, detail strength va
  prompt validation. Rust cung reject detail strength ngoai 0..100.
- Cap nhat expectation cho provider/module/purpose Phase 5 va chay lai
  `UPDATE_BACKEND_FIXTURES=1 cargo test contract_fixtures`; fixtures hien tai khong drift.
- Thu lai `npm run schema:export`: `tsx` bi loi `uv_os_get_passwd ENOMEM` trong moi truong.
  Da bundle cung script bang esbuild va chay thanh cong de ghi
  `packages/domain/schema/project-dna.schema.json`; file da khop, khong phat sinh diff.

## Con no

- Khong con loi code/test trong pham vi Phase 5. Marker `TODO(p5-domain)` con xuat hien trong
  `docs/agent-tasks/p5-ui.md` la huong dan task (khong sua theo yeu cau khong edit task); khong
  con marker nao trong source/test.

## Lenh test

- `npm.cmd run verify` (pass: typecheck, lint, 31 Vitest files / 387 tests, Rust 243 passed / 6
  ignored).
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check` (pass).
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`
  (pass).
- `npx.cmd prettier --check .` (pass).
- `UPDATE_BACKEND_FIXTURES=1 cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
  contract_fixtures --no-default-features` (pass; fixtures current).

## Cam bay da gap

- Khong co live paid API call; cac smoke test provider van `#[ignore]`.
- Lenh `npm run schema:export` van phu thuoc loi `uv_os_get_passwd ENOMEM`; ban bundle esbuild
  da chay thanh cong va tao cung output canonical.

