# wt/unrestricted-generation

## Mục tiêu
Bỏ khóa theo bước khi tạo ảnh; hiển thị chọn provider/model ngay trong chế độ Đơn giản.

## Đã xong
- Workflow chỉ theo dõi tiến độ. DNA mở độc lập và có thể sửa cả khi đã xác nhận.
- Bỏ điều kiện DNA/Master/Anchor approval tại form, mock, Rust validation và queue insertion.
- Provider/model hiển thị đầu panel trong cả hai chế độ. Chọn provider chưa có key được,
  nhưng tạo vẫn yêu cầu key; nút cài đặt mở đúng provider được chọn.
- Cập nhật API contract/ADR-046 và test theo yêu cầu mới; không xóa lịch sử xác nhận.

## Kiểm tra
`npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test -- --maxWorkers=4`,
`npm run build -w @arch/desktop`, `npm run test:ui`.
`cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml`: 364 pass, 6 ignored.
`cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`: đạt.
Bằng chứng: docs/design/free-generation/QA.md.

## Cạm bẫy và còn nợ
Bỏ gate cả validation lẫn queue insertion; chỉ sửa UI sẽ không đủ.
Giữ manual section locks, archive guards, input checks, conflict validation và xác nhận chi phí.
Camera batch cần ảnh nguồn/camera thật để lập request, đây không phải khóa theo tiến độ.
Chưa gọi provider có phí; chưa mô phỏng Windows display scaling thật.
Không đụng repo cũ D:\IMAGE-CREATIVE-ARCHITECT có commit riêng.

Kết quả frontend/domain: 103 file, 1.152 test đạt. Browser QA: simpleModelSelection=true, dnaOnlyWithoutConfirmation=true.
