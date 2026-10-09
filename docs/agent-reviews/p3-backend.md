# Review p3-backend — vòng 1

## Kết luận: PHẢI SỬA

## PHẢI SỬA (chặn merge)

- [apps/desktop/src-tauri/src/services/queue.rs](/D:/IMAGE-CREATIVE-ARCHITECT/apps/desktop/src-tauri/src/services/queue.rs:292): Nếu tạo thread cho một `Claim` thất bại, mã chỉ ghi log. Job đã bị chuyển sang `running` và slot đã bị giữ trong `slots.running`, nhưng không có thread nào chạy để hoàn tất hoặc giải phóng slot. Job mắc kẹt đến lần khởi động lại; các job cùng provider có thể mất slot. Khi `spawn` lỗi, cần hoàn nguyên claim hoặc kết thúc job bằng lỗi, giải phóng slot và đánh thức dispatcher.
- [apps/desktop/src-tauri/src/services/generations.rs](/D:/IMAGE-CREATIVE-ARCHITECT/apps/desktop/src-tauri/src/services/generations.rs:164): `validate` kiểm tra `cameraId` tồn tại trong DNA, nhưng kiểm tra đó diễn ra trước transaction chèn job. [insert_queued](/D:/IMAGE-CREATIVE-ARCHITECT/apps/desktop/src-tauri/src/services/generations.rs:362) chỉ kiểm tra project và references, không kiểm tra lại camera trong transaction. Nếu `dna_update` xóa camera sau validation nhưng trước insert, `generation_submit` hoặc `batch_create` vẫn enqueue generation trỏ tới camera không còn tồn tại. Kiểm tra lại `cameraId` trong transaction chèn; với batch, bảo đảm mọi item vẫn hợp lệ trước khi commit.

## NÊN SỬA

- [apps/desktop/src-tauri/src/services/queue.rs](/D:/IMAGE-CREATIVE-ARCHITECT/apps/desktop/src-tauri/src/services/queue.rs:316): Khi retry đã đến hạn nhưng slot provider vẫn bận, `until_next_retry` trả về tối thiểu 10 ms. Dispatcher lặp lại claim liên tục cho tới khi slot được giải phóng, gây polling và tải CPU không cần thiết. Khi retry đã quá hạn nhưng chưa thể chạy, chờ wake từ lúc slot được giải phóng hoặc dùng khoảng chờ dài hơn.
- [apps/desktop/src-tauri/src/services/queue.rs](/D:/IMAGE-CREATIVE-ARCHITECT/apps/desktop/src-tauri/src/services/queue.rs:213): Nếu `run_job` panic, `SlotGuard` giải phóng slot nhưng job vẫn ở `running`; dispatcher không claim lại job đó và không phát event kết thúc. Người dùng thấy job chạy mãi cho tới lần khởi động lại. Cân nhắc bắt panic quanh attempt, ghi nhận lỗi và cập nhật job/generation sang trạng thái kết thúc.
- [apps/desktop/src-tauri/src/services/queue.rs](/D:/IMAGE-CREATIVE-ARCHITECT/apps/desktop/src-tauri/src/services/queue.rs:594): Test concurrency dùng `sleep` 150 ms và polling theo thời gian. Dưới tải CI, lịch chạy thread có thể khiến kiểm tra overlap chập chờn. Dùng barrier hoặc đồng bộ hóa tường minh trong provider double để test giới hạn slot mà không phụ thuộc thời gian.

## ĐẠT / điểm tốt

- `claim` áp dụng thứ tự ưu tiên rồi đến thời điểm tạo, đồng thời giới hạn slot theo từng provider.
- Provider call chạy ngoài DB lock; transaction cuối kiểm tra job vẫn `running` trước khi ghi outputs.
- Hủy job đang chạy được kiểm tra lại trước commit; nếu cancel xảy ra sau khi ghi file, đường lỗi dọn các file đã tạo.
- Retry dùng các mốc 15/60 giây, đếm `attempt` khi claim và dừng sau `max_attempts`.
- `batch_create` validate item trước khi insert và ghi batch cùng jobs/generations trong một transaction.
- Anchor kiểm tra camera anchor view, asset sẵn sàng và cùng project; xóa asset cascade anchor, còn `dna_update` xóa anchor của camera đã bị gỡ.
- Fixture dùng `open_with` với môi trường rỗng và Gemini trỏ tới `127.0.0.1:9`, tránh dùng key môi trường hoặc gọi API thật.

## Đã chạy

Không chạy test: sandbox hiện chỉ cho phép đọc filesystem; `cargo test` cần ghi build artifacts và dữ liệu test.