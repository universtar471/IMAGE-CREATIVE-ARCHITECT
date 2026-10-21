# wt/hhtech-connection

## Mục tiêu
Sửa HHTECH có key đã lưu nhưng báo thiếu HHTECH_BASE_URL.

## Đã xong
- Máy chủ mặc định https://hhtechapi.com/v1; cấu hình URL riêng vẫn ưu tiên.
- Custom gateway không có mặc định. URL sai/tài khoản trong URL/http không an toàn vẫn bị chặn.
- Cập nhật hướng dẫn VI/EN, .env.example, API contract và ADR-048.
- Đã thêm URL-only vào .env được gitignore ở bản clone người dùng; không đọc/in/đổi key.
- GET /v1/models không gửi key nhận 401: máy chủ có phản hồi, chưa xác minh key của người dùng.
- Nguồn endpoint: https://hhtechapi.com/ (OpenAI-compatible integration).

## Test
`npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test -- --maxWorkers=4`,
`npm run build -w @arch/desktop`, `npm run test:ui`.
`cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml`,
`cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`.
Regression default URL đã thất bại trước sửa đúng lỗi screenshot.

## Cạm bẫy / còn nợ
Không gọi HHTECH /models bằng key thật hoặc tạo ảnh trả phí trong test.
Các test mặc định chỉ đọc config/descriptors; HTTP có key giả chỉ dùng server loopback.
Giữ env override và mọi kiểm tra an toàn URL. Không tự chuyển sang domain khác khi lỗi.
Đóng app cũ và chạy lại để nạp .env / backend mới; sau đó người dùng bấm Kiểm tra kết nối.

Kết quả: 1.153 test frontend/domain, 365 test Rust đạt (6 live-provider ignored). Typecheck, lint, format, build, browser QA và Clippy -D warnings đạt.
