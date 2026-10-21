# wt/advisory-creative-conflicts

## Mục tiêu
Sửa tạo ảnh bị khóa bởi tổ hợp Bình minh + Xe đô thị + Vệt sáng xe.

## Đã xong
- Cảnh báo sáng tạo chỉ để tham khảo, không khóa nút, không bắt sửa hoặc duyệt ngoại lệ.
- Bỏ chặn tại UI/store/mock/Rust; batch giữ đủ mục và retry giữ đánh giá mới.
- Giữ nguyên verdict/codes trong lịch sử; không tự duyệt hay xóa cảnh báo.
- Giữ xác nhận chi phí, key, model/params, archive, readiness và ownership checks.
- ADR-047 và API contract cập nhật hành vi; không thay kiểm tra chứng cứ khi xuất bản.

## Kiểm tra
`npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test -- --maxWorkers=4`,
`npm run build -w @arch/desktop`, `npm run test:ui`.
Rust: 364 pass, 6 live-provider ignored; Clippy -D warnings đạt.
UI regression tái hiện lỗi trước sửa và mở được xác nhận chi phí sau sửa.

## Cạm bẫy và còn nợ
Chỉ mở nút UI là chưa đủ: store, native validation, batch và retry đều có gate cũ.
Không gọi provider có phí. Browser QA dùng mock; không mô phỏng Windows Display Scale thật.
Không sửa repo cũ D:\IMAGE-CREATIVE-ARCHITECT có commit riêng.

Kết quả cuối: 103 file / 1.153 test frontend-domain đạt; browser creativeConflictDoesNotBlock=true, noWrites=true.
