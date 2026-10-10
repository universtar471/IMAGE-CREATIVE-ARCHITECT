# Bàn giao `wt/anchor-domain`

## Mục tiêu

Triển khai ADR-028 và API contract §19 cho domain, knowledge packs, compiler pc-1.5.0 và Rust DNA validation.

## Đã làm

- Thêm `context.siteTopology` và refinement corner lot/corner side vào Zod schema, `ContextPartialSchema`, JSON Schema sinh và Rust `validate_additive_fields`.
- Thêm test Rust cho DNA hợp lệ, corner lot thiếu `cornerSide`, corner side attached và DNA không có topology.
- Thêm `prompt/topology.ts` và export từ domain index: inference attached, revealed side, camera site plan và view framing.
- Nâng compiler lên `pc-1.5.0`: framing theo `viewType`, master giữ toàn bộ visible site, mode `oblique_street`/`aerial_block`/`corner_side`/`unknown_side`, contextual negatives dedupe, style phrases.
- Rà soát prompt nội thất tiếng Anh, tăng lens wide nội thất lên 20/22 mm, đổi composition pack townhouse/urban villa/aerial và khai báo topology attached cho hai pack townhouse. Các pack đã đổi đều bump `packVersion` lên `1.3.0`.
- Cập nhật golden/in-line snapshots và thêm `packages/domain/tests/anchor-domain.test.ts` bao phủ bảng mode, inference, compiler, schema, packs và catalog.

## Cạm bẫy

- `npm run schema:export` trực tiếp lỗi `uv_os_get_passwd ... ENOMEM` trong sandbox. Đã dùng esbuild bundle vào `%TEMP%\\anchor-domain-schema-export.mjs`, rồi chạy Node để sinh `packages/domain/schema/project-dna.schema.json`.
- Không đổi chữ ký API trong `docs/API_CONTRACTS.md`.
- Không gọi API trả phí; các live provider tests vẫn bị ignore theo điều kiện key môi trường.

## Kiểm tra

- `npm.cmd run verify`: xanh; typecheck, lint, 42 test files / 504 tests, Rust test 271 passed / 0 failed / 6 ignored.
- `cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml`: xanh.
- `cargo clippy --all-targets --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings`: xanh.
- `npx.cmd prettier --check .`: xanh.

Chưa tạo commit theo yêu cầu.
