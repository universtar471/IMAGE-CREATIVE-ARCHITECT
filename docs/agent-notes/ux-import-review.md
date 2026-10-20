# wt/ux-import-review

- Agent: codex
- Tach tu: origin/main
- Tao luc: 2026-10-21 00:28

## Muc tieu

Sửa ảnh khay dưới bị cắt, Node bỏ qua ảnh nhập thường, hướng dẫn dài ở panel và khóa chỉnh sửa do thiếu Master.
Cập nhật thương hiệu theo board Option C / Blueprint Studio do người dùng gửi: IMAGE-CREATIVE-ARCHITECT.

## Da xong

- Đã thêm regression tests, sửa domain/UI/mock/Rust; nguồn nhập không bị đổi vai trò hay bytes.
- Node dựng sau khi tải layout để Fit View chính xác; chọn tray/import đồng bộ selection.
- Font/icon SVG và PNG/ICO/ICNS theo mẫu; giữ identifier để không chuyển thư mục dữ liệu.
- QA và ảnh: `docs/design/imported-image-review/QA.md`.

## Con no

QA thủ công cửa sổ Tauri/WebView2 và display scaling thật; browser QA dùng mock, không provider có phí.

## Lenh test

`npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test -- --maxWorkers=4`,
`npm run build -w @arch/desktop`, `npm run test:ui`.
`cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` (367 pass, 6 ignored),
`cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`.

## Cam bay da gap

- Không chỉ sửa UI gate: backend cũng chặn edit nếu chưa có Master.
- Graph builder trước đây loại regular_image; mounted trước layout làm Fit View sai.
- Checkbox + metadata làm thẻ cao quá khay; min-height/flex phải tính cùng một hộp.
- `asset_preview` là lệnh đọc, không được coi là write trong browser spy.
- Hướng dẫn chuyển vào portal: test phải mở `?` rồi tìm role note; error/cost vẫn đọc trực tiếp.
- Không đụng nhánh main local có 17 commit riêng ở repo cũ D:\IMAGE-CREATIVE-ARCHITECT.

