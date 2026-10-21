# wt/unified-creation-upscale

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-22 03:47

## Muc tieu

Phản hồi 22/10: gọn bảng tạo ảnh, nguồn text/ảnh rõ ràng, model ở các công cụ,
diagram đơn giản, xuất bản qua API, kéo node ở xa, upscale local/API đúng tỷ lệ.

## Da xong

- Bỏ MoodPreview giả lập, giữ ảnh chỉnh màu thật và các thẻ chọn look.
- Bỏ chế độ Advanced và các nhóm workflow/seed/reference nâng cao ở Generate.
  DNA Hero không đính kèm ảnh kể cả draft cũ còn reference IDs; text nằm trong nguồn.
  SketchUp và nhập ảnh chỉ xuất hiện trong nguồn phác thảo/khối, vẫn nhập được text/preset.
- Model picker hiển thị trên Mood, vùng, chi tiết, diagram, xuất bản và upscale.
  Chi tiết dùng model đã chọn khi mở BatchDialog. Video giữ picker hiện đầu bảng.
- Diagram mặc định tạo một sheet qua API: ảnh nguồn + icon kiểu + prompt + model;
  dùng một hàm biên dịch cho preview/submit, không cần duyệt từng bước.
  Luồng vector cũ vẫn ở Dàn trang / Xuất file, giữ kiểm tra dữ kiện để không tự phê duyệt.
- Xuất bản tạo cover/board/editorial/social artwork bằng nhà cung cấp ảnh đã kết nối.
  Kết quả vào thư viện; nút dùng để xuất bản tạo bản dàn trang với fit contain,
  giữ nguyên artwork và mở đường xuất PDF/PNG sẵn có. Prompt không bịa số liệu/mặt bằng ẩn.
- Node: tắt auto-pan khi kéo, chuột trái kéo node; Space+kéo hoặc chuột giữa/phải để pan.
  Tắt native image drag. Browser QA kéo node ở (6000,4000), zoom 0.25 và kiểm tra
  vị trí được lưu thay đổi trong khi viewport đứng yên.
- Upscale local chọn mục tiêu cao hơn nguồn (2K/4K/8K trong giới hạn), có trạng thái/lỗi.
  Hướng dẫn nằm đầu bảng. Không đổi quy tắc keep/skip khi người dùng chủ động chọn.
- API upscale xin tỷ lệ được model hỗ trợ gần nguồn nhất. Nếu model vẫn trả sai tỷ lệ,
  contain/padding thay cho ép dãn. Prompt giữ khung hình và cho ảnh gốc ưu tiên hơn DNA.

## Con no

- Không gọi API trả phí để đánh giá ảnh diagram/xuất bản/upscale thực tế.
  Bộ test dùng mock; chữ và chất lượng ảnh do từng model quyết định.

## Lenh test

Kết quả: 105 file / 1.163 test frontend đạt; 366 test Rust đạt, 6 live-provider bỏ qua.
Test bổ sung yêu cầu tỷ lệ upscale đã đạt. Typecheck, lint, định dạng, build, clippy
và browser QA (gồm kéo node xa, bảng AI diagram/xuất bản) đạt.

- `npm test -- --maxWorkers=4`
- `npm run typecheck`, `npm run lint`, `npm run format:check`
- `npm run build -w @arch/desktop`, `npm run test:ui`
- `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`

## Cam bay da gap

- Test Rust tái hiện ép dãn vuông → dọc đã thất bại trước sửa, sau sửa giữ hình vuông có padding.
- Ảnh nguồn đã lớn hơn 2K trước đây có mặc định keep nên kết quả đúng hợp đồng nhưng nhìn như không chạy.
- Các test editor diagram/publication cũ gọi Local* rõ ràng; test mới đi luồng AI mặc định.
- Giữ prompt legacy byte-identical khi không có preservationMode; chỉ thay mẫu API upscale hiện hành.
- Browser QA không gửi generation hay thao tác trả phí; chỉ ghi layout mock trong bài kéo node.

