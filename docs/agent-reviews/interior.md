# Review — Interior DNA (wt/interior-domain, wt/interior-ui, wt/interior-integrate)

Reviewer: Codex (gpt-6-luna, read-only), verified by Claude. Date: 2026-10-10.

## PHẢI SỬA (đã sửa ở 0700b69)
- `NewProjectWizard.tsx`: bước kiến trúc khoá Next theo số tầng/kích thước bị ẩn khi chọn nội thất → nội thất chỉ validate use/room/style.
- `lib/interior.ts` fold không gộp `đ` → UI dùng matcher domain (đã gộp `đ`), thêm test "Đông Dương"/"dong duong".
- `applyStyleDefaults` ghi đè palette/preset: giữ đúng API §18.3 (đặt palette + preset), UI hỏi xác nhận trước khi ghi đè lựa chọn người dùng.

## NÊN SỬA (đã sửa)
- Test legacy so hai lần cùng compiler → thay bằng golden pc-1.3.0 cho mọi project type.
- Nhãn: "Vi xi măng" → "Microcement", brushed brass → "Đồng thau xước".

## ĐẠT
- Id danh mục, cascade phòng (`other` luôn hợp lệ), preset đủ 7 slot, thứ tự section compiler pc-1.4.0, lỗi Rust tại `interior.roomId`.
- Verify độc lập: 495 Vitest, 267 Rust (6 live ignored), fmt/clippy/prettier sạch.
