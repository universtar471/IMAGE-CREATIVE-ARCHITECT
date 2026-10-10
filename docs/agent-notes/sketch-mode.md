# wt/sketch-mode

- Agent: Codex
- Tách từ: `main`
- Tạo lúc: 2026-10-10 17:25

## Mục tiêu

Triển khai ADR-026 / API §17: dùng ảnh phác thảo hoặc khối làm nguồn hình học cho ảnh Hero.

## Đã xong

- Thêm role `structure_sketch` vào Zod, Rust, nhãn domain/UI, badge và provider role hint.
- Đặt role ngay sau Master trong thứ tự compiler, loại khỏi chọn tham chiếu mặc định.
- Nâng compiler lên `pc-1.2.2`, thêm instruction và preservation line đúng API §17.2; giữ nguyên ưu tiên Master.
- Thêm Generate source `dna | sketch`: ép Hero, chọn sketch sẵn sàng mới nhất, cho chọn thumbnail, ghim sketch làm ảnh 1, lấy tỷ lệ từ sketch, chặn model không hỗ trợ image-to-image.
- Thêm nút nhập sketch dùng lại luồng import với role `structure_sketch`, kèm hướng dẫn và lý do bị vô hiệu hóa.
- Mock backend nhận role mới; thêm test form, panel toggle/import, compiler, backend round-trip/import, i18n parity và dấu tiếng Việt.
- Không gọi live API; 6 live paid tests của Rust vẫn được ignore.

## Còn nợ

- Không còn nợ code/test.
- `npm run schema:export` đã được chạy nhưng môi trường dừng trước khi export với `uv_os_get_passwd returned ENOMEM`. `npm run verify` vẫn chạy test drift JSON schema và đã xanh; thay đổi role này không làm đổi Project DNA schema đã check-in.

## Lệnh test

- `npm.cmd run verify` — xanh: 36 files / 439 Vitest; 257 Rust pass, 6 ignored live API.
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check` — xanh.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings` — xanh.
- `npx.cmd prettier --check .` — xanh.

## Cạm bẫy đã gặp

- PowerShell chặn `npm.ps1`; dùng `npm.cmd` / `npx.cmd`.
- Schema export gặp đúng lỗi sandbox ENOMEM đã nêu trong task; drift test là kiểm chứng thay thế.

