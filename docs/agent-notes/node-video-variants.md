# wt/node-video-variants

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-22 00:46

## Muc tieu

Sửa phản hồi ảnh chụp 22/10: tự đặt người/xe, trạng thái và model của node,
video có model và bản nháp, bảng nâng cấp gọn hơn, biến thể từ ảnh đang chọn.

## Da xong

- Preset người/xe dùng `autoPlacement`; prompt yêu cầu chọn mặt đường/bề mặt có sẵn,
  đúng tỷ lệ và theo hướng dẫn người dùng. Không cần khai báo vị trí trong DNA.
  Nâng cấp lựa chọn preset đã lưu; giữ nguyên yêu cầu vị trí cụ thể và dữ liệu gốc.
- Node đang chạy có vòng xoay, viền sáng và trạng thái truy cập được; node kết quả và
  node tác vụ ghi tên model đầy đủ, dự phòng model ID khi không có catalog.
- Mở công cụ video tạo node nháp nối từ ảnh chọn, không gửi yêu cầu trả phí.
  Model luôn hiện, cả nhà cung cấp chỉ có một model. Bộ chọn nằm đầu bảng; chuyển động có icon.
- Nâng cấp có icon chế độ, khóa và kích thước; nhãn chế độ ngắn, giải thích trong (?).
- Tạo biến thể giữ ảnh gốc, mở nhóm góc máy/chi tiết trước và bỏ nhóm render ban đầu.
  Đổi model/provider giữ ảnh gốc và tham số còn được hỗ trợ.
- Ảnh nguồn được mô tả là nguồn thiết kế chính thay vì tham khảo tự do.
  Preview và submit dùng cùng cách biên dịch; nguồn và phiên bản chỉ dẫn có trong provenance hash.
  Chế độ đơn giản có lựa chọn kích thước/chất lượng khi model hỗ trợ.

## Con no

- Chưa so sánh ảnh thực bằng các model trả phí. Chênh lệch chất lượng nội tại của model
  không thể được loại bỏ bằng sửa giao diện; không tuyên bố chất lượng tương đương.

## Lenh test

Kết quả cục bộ: 104 file / 1.158 test frontend đạt; 365 test Rust đạt, 6 live-provider
bỏ qua; test round-trip mới cho `autoPlacement` đạt. Typecheck, lint, định dạng, build,
clippy và browser QA (bao gồm biến thể/video/nâng cấp, không ghi dữ liệu) đạt.

- `npm test -- --maxWorkers=4`
- `npm run typecheck`, `npm run lint`, `npm run format:check`
- `npm run build -w @arch/desktop`, `npm run test:ui`
- `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`

## Cam bay da gap

- Hồi quy trước sửa: biến thể bị đổi thành hero, selector model video bị ẩn với một model.
- Test cũ buộc nguồn sketch thành hero được cập nhật theo hành vi biến thể mới.
- Browser QA phải quay lại Studio trước bước phát video; Node mode dùng graph.
- Không đọc hay thay key; không gọi API trả phí trong kiểm tra.

