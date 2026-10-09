# Review p3-ui — vòng 1

## Kết luận: PHẢI SỬA

## PHẢI SỬA (chặn merge)

1. **Response polling có thể ghi đè trạng thái mới do event hoặc request mới hơn.**  
   `apps/desktop/src/app/store.ts:519-522, 630-635, 740-746` — `refreshGenerations()` thay toàn bộ history bằng kết quả `generation_list`; `refreshJobs()` cũng thay toàn bộ `jobs` bằng kết quả `job_list`. Không kiểm tra request revision hoặc trạng thái hiện tại trước khi ghi. Ví dụ: một poll bắt đầu khi job còn `running`; event `completed` cập nhật store; sau đó poll cũ trả về và đưa job/generation về `running`. Retry hoặc Cancel có thể hiện sai cho tới lần refresh tiếp theo.  
   **Sửa:** gắn revision/token cho poll và bỏ response cũ; khi hòa giải kết quả, không để snapshot cũ lùi trạng thái đã nhận qua event. Thêm test điều khiển thứ tự resolve để xác nhận `completed` không bị poll cũ ghi đè.

## NÊN SỬA

1. **Unsubscribe không giải phóng listener Tauri khi hết subscriber.**  
   `apps/desktop/src/lib/bridge.ts:251-258` — hàm cleanup chỉ xóa handler khỏi `Set`; `disconnectEvents()` chỉ được gọi khi thay transport. Nếu App unmount, native `listen` vẫn đăng ký dù không còn handler, và giữ kết nối đến khi transport bị thay hoặc ứng dụng thoát.  
   **Sửa:** khi tổng subscriber về 0, gọi teardown kết nối; xử lý cả trường hợp unsubscribe trong lúc `connectEvents()` còn pending. Thêm test xác nhận unsubscribe cuối cùng gọi teardown.

## ĐẠT / điểm tốt

- Bridge parse payload event bằng schema và có unsubscribe; `App` dọn interval polling khi unmount.
- Bản tích hợp dùng domain camera/batch helpers thật. `planBatch` chặn batch vượt `MAX_BATCH_ITEMS`, kiểm tra provider/model và validate item; dialog dựng lại plan từ persisted project snapshot trước khi queue.
- Camera Director có chuyển đổi azimuth/distance ↔ SVG, snapping, pointer capture, keyboard nudge và nhãn truy cập được. Contact Sheet nhóm theo camera và đưa retry vào cùng batch theo generation.
- Mock kiểm tra trạng thái archive trước khi lưu outputs và triển khai cancel, retry, concurrency theo provider. API key không nằm trong store; regression tests P2 kiểm tra các tình huống submit/đổi project, asset adoption, reopen khi generation kết thúc, stale provider list, dialog focus và xóa key input.
- Typecheck thành công.

## Đã chạy

- `npm.cmd run typecheck` — **PASS**.
- `npm.cmd test -- --project desktop apps/desktop/tests/queue.test.ts apps/desktop/tests/camera.test.ts apps/desktop/tests/reviewP2.test.tsx apps/desktop/tests/generateFlow.test.ts` — **không chạy được**: Vite không thể ghi file cấu hình tạm trong `node_modules/.vite-temp` (`EPERM`) dưới sandbox chỉ đọc.
- Working tree trên `main` sạch; không chỉnh sửa, tạo hoặc commit file.