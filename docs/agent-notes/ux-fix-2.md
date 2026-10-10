# wt/ux-fix-2

- Agent: Codex
- Base: main
- Ngày: 2026-10-11

## Mục tiêu

Hoàn thiện phản hồi UX theo brief `docs/agent-tasks/ux-fix-2.md` và ADR-029.

## Đã làm

- Reopen chỉ chuyển bước được chọn sang `open`; các bước DNA đã xác nhận phía sau được giữ nguyên. Đồng bộ domain, backend Rust, mock backend contract fixture và kiểm thử.
- Thêm xác nhận lại một lần cho bước `needs_review`, nút thêm góc máy ở bước Camera đã xác nhận, và nút xác nhận hàng loạt trên Tổng quan khi có ít nhất hai bước cần xem lại.
- Đổi next step sang khóa i18n phẳng cho đủ chín step id. Đưa nút compact vào hàng header; Tổng quan vẫn dùng thẻ lớn.
- Ảnh strip và contact sheet dùng `contain`, nền letterbox trung tính, nhãn/metadata ở dưới ảnh.
- Thêm chế độ ảnh lớn dạng lưới và danh sách; lựa chọn được lưu/đọc từ `localStorage` trong `try/catch`. Danh sách có đủ tên, vai trò, model, kích thước, ngày và trạng thái.
- Sửa spacing/case của phần chỉnh vùng và nâng prompt compiler lên `pc-1.5.1`; câu góc chéo nêu rõ 30–35° dọc theo phố. Cập nhật các kỳ vọng phiên bản/prompt có chủ đích.
- Không gọi API mạng hoặc API trả phí. Không commit.

## Còn nợ

- Không còn việc trong brief.

## Lệnh kiểm tra

- `npm run verify` — đạt: typecheck, lint, 525 kiểm thử TS trong 44 tệp, 272 kiểm thử Rust đạt, 6 kiểm thử Rust live bị ignore.
- `npx prettier --check .` — đạt.

## Cạm bẫy

- ADR-022 và test backend cũ còn mô tả cascade. ADR-029 thay thế hành vi đó; vì vậy cần đồng bộ backend Rust và cập nhật fixture `workflow_reopen_step` để kiểm tra toàn ứng dụng xanh.
- Rust build ban đầu mất vài phút do dependency chưa được biên dịch trong worktree.
