# wt/p4-fix-domain

- Agent: codex
- Tach tu: wt/p4-integrate
- Tao luc: 2026-10-09 22:47

## Muc tieu

Sửa các finding vòng 1 của Phase 4 domain/backend theo `p4-domain.md` và
`p4-backend.md`, không thay đổi fixture vì DTO không đổi.

## Da xong

- Mood variation: nguồn được chọn (kể cả output `regular_image`) luôn mang role
  `master_architecture`, nên prompt giữ kiến trúc/bố cục. Test:
  `treats a selected output as the master reference for mood variations`.
- Mood preset schema giữ `lighting` và `weather` lồng trong `values`; ba pack có
  preset cinematic/dusk thực tế với blue hour và weather. Test:
  `loads mood lighting and weather values and respects locks when varying and adopting`
  kiểm tra load qua `KnowledgeRegistry`, build, adopt và locks.
- `applyGradeToImageData(data, grade, out?)` mặc định clone input, cho phép caller
  truyền chính `data` để in-place; vòng pixel dùng scratch tuple tái sử dụng.
  `GradeCanvas` truyền chunk làm `out`. Tests:
  `returns a graded buffer without mutating the source by default` và
  `supports an explicit in-place output buffer`.
- Rust `ColorGrade.schema_version` không còn serde default; request thiếu
  `schemaVersion` bị reject. Parity test assert input/output vector lengths trước
  `zip`.
- API contract 12.2 mô tả lighting/weather tùy chọn trong mood preset values.

## Con no

- Không còn nợ code. Grade vectors và backend fixtures không đổi.

## Lenh test

- `npx.cmd vitest run packages/domain/tests/phase4.test.ts` — 10/10.
- `npx.cmd vitest run packages/domain/tests` — 127/127.
- `npm.cmd run typecheck` — xanh.
- `npm.cmd run lint` — xanh.
- `npm.cmd run verify` với `CARGO_TARGET_DIR=F:\\codex-target-p4-fix-domain`,
  `CARGO_PROFILE_TEST_DEBUG=0`, `CARGO_INCREMENTAL=0` — xanh; 311 Vitest,
  231 Rust tests (226 pass, 5 ignored).
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check` — xanh.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`
  với target F — xanh.
- `npx.cmd prettier --check .` — xanh.

## Cam bay da gap

- Ổ D hết dung lượng khi Cargo test profile mặc định link debug symbols. Đã xóa
  `apps/desktop/src-tauri/target` (artefact build không track) và chạy lại bằng
  target tạm trên F; source/fixture không bị xóa.

