# Review — UX round 2 (wt/ux-fix-2, wt/ux-preview, wt/ux2-integrate)

Reviewer: Codex (gpt-6-luna, read-only), verified by Claude. Date: 2026-10-11. Coding by default Codex (HHTECH out of credit).

## PHẢI SỬA (đã sửa ở f3efa1d)
- `StepFrame.tsx`: "Thêm góc máy" chỉ mở khóa bước → giờ mở luôn luồng thêm góc máy.
- `GradePreview.tsx` + `app.css`: chế độ split ẩn cả hai ảnh → ảnh gốc nằm dưới, ảnh đã chỉnh cắt theo thanh trượt.
- `MoodPreview.tsx`: so khớp cả chuỗi với khóa ngắn → preset rơi về cùng bảng màu; giờ khớp theo id rồi từ khóa, mọi preset có màu riêng.

## NÊN SỬA (đã sửa)
- `BottomTray.tsx`: chế độ Danh sách mất chọn nhiều để nâng cấp hàng loạt và nút so sánh.
- Test preview thiếu kiểm tra màu/tông thực tế và chế độ split.

## ĐẠT
- Mở lại bước không lan sang bước sau; khóa i18n phẳng cho bước tiếp theo; ảnh khay không bị cắt; chữ Chỉnh vùng không chồng.
- Verify độc lập: 534 Vitest, 272 Rust (6 live ignored), fmt/clippy/prettier sạch.
