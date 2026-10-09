# Review p3-fixes — vòng 2

## Kết luận: PHẢI SỬA

## PHẢI SỬA (chặn merge)

- `apps/desktop/src/app/store.ts:621-622`: Khi `submitGeneration` nhận kết quả command, nó thêm generation vào store nhưng không cập nhật `generationSeenAt`. Nếu một `generation_list` poll bắt đầu trước khi submit, rồi trả về sau kết quả submit mà không có generation mới, `mergePolled` có thể bỏ generation vừa thêm khỏi store. Event thường che được lỗi này, nhưng race vẫn xảy ra nếu listener chưa kết nối hoặc bỏ lỡ event. Cập nhật dấu thời gian đồng bộ khi nhận command result; làm tương tự tại `:669-670` cho `retryGeneration`. Thêm test giữ poll cũ, nhận command result khi không có event, rồi xác nhận poll không xóa generation.

## NÊN SỬA

- `docs/API_CONTRACTS.md:311-313`: Tài liệu nói generation `failed` là do lỗi provider sau khi call bắt đầu. Các lỗi khởi chạy thread và panic nay cũng tạo trạng thái `failed` với `kind: interrupted`. Bổ sung trường hợp này để hợp đồng API mô tả đúng hành vi.

## ĐẠT / điểm tốt

- Các test mới cho batch reference, regex ULID, camera bị xóa trước insert và rollback cả batch đều nhắm đúng lỗi vòng 1; theo nội dung/assertion, chúng sẽ thất bại nếu bỏ phần sửa tương ứng.
- Có test cho spawn thread thất bại, panic, retry quá hạn khi slot bận và đồng bộ concurrency bằng gate thay cho `sleep`.
- Poll cũ bị loại khi có poll mới; event mới hơn được giữ qua merge. Test ép thứ tự phản hồi riêng cho jobs và generations.
- Bridge teardown xử lý subscriber cuối cùng rời đi và unsubscribe khi kết nối còn pending; có test cho cả hai tình huống.
- Schema JSON xuất ra khớp regex ULID đã sửa.

## Đã chạy

- Đã thử chạy Vitest cho domain và desktop bằng `npm.cmd exec -- vitest run ...`; không khởi động được vì sandbox từ chối ghi file tạm vào `node_modules/.vite-temp` (`EPERM`).
- Đã thử `cargo test --lib` cho các test queue và camera; không khởi động được vì sandbox từ chối mở `target/debug/.cargo-build-lock` (Access denied).
- Đã đọc diff và test liên quan. Do các giới hạn trên, chưa xác nhận được test chạy xanh.