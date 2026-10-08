# Review P2-B (wt/p2-gemini)

## Kết luận: PHẢI SỬA

Có lỗi che API key và xử lý `finishReason` chưa đúng yêu cầu. Chưa xác nhận được test/clippy xanh vì sandbox chặn Cargo.

Các đường dẫn dưới đây tính từ `apps/desktop/src-tauri/src/providers/gemini/`.

## PHẢI SỬA (chặn merge)

1. **[P1] `wire.rs:67`, `wire.rs:99`, `mod.rs:228` — HTTP 200 có thể làm lộ key trong message/meta.**  
   `parse_success` không nhận key và không gọi `sanitize`. Mock trả HTTP 200 với text chứa key, không có ảnh → `BadResponse.message` chứa nguyên key; nếu có ảnh → key vào `meta.text`. `modelVersion`, `finishReason`, `blockReason` cũng được sao chép trực tiếp. Live smoke test còn in `meta` tại `tests.rs:563`.  
   **Sửa:** che key trước khi cắt ngắn mọi chuỗi đi vào message/meta; kiểm tra cả lỗi validation có chèn dữ liệu đầu vào. Thêm mock chứa key ở từng trường, cho trường hợp không ảnh, thành công và partial failure. Test hiện tại tại `tests.rs:358` chỉ chứng minh việc che key trong HTTP lỗi.

2. **[P2] `wire.rs:80`, `wire.rs:101` — Chỉ xét finish reason đầu tiên và bỏ qua lý do chặn khi có ảnh.**  
   Response gồm candidate đầu `STOP` không ảnh, candidate sau `IMAGE_SAFETY` → trả `BadResponse`, thay vì `Blocked`. Candidate có ảnh cùng `finishReason: IMAGE_SAFETY` lại được trả thành công vì nhánh `images.is_empty()` chạy trước kiểm tra chặn.  
   **Sửa:** xét finish reason từng candidate trước khi nhận ảnh; bỏ ảnh thuộc candidate bị chặn, giữ ảnh hợp lệ từ candidate khác. Nếu không còn ảnh và có lý do chặn, trả `Blocked`. Thêm test cho cả hai tình huống; test tại `tests.rs:394` chỉ có một candidate không ảnh.

## NÊN SỬA

1. **`mod.rs:256` — `test_connection` báo kết nối thành công với response không phải metadata.**  
   HTTP 200 chứa HTML hoặc `{}` vẫn trả “Connected … is available” do fallback `DEFAULT_MODEL`. Proxy trả trang đăng nhập có thể khiến UI báo key hợp lệ sai.  
   **Sửa:** yêu cầu JSON metadata hợp lệ, kiểm tra `name`; trả `BadResponse` khi sai cấu trúc. Bổ sung mock HTML/JSON thiếu trường.

2. **`tests.rs:66`, `tests.rs:306` — Mock có thể treo khi hành vi số lần gọi bị regression.**  
   Nếu adapter gọi cả hai response trong `auth_failure_stops_further_calls`, kết nối “đánh thức” có thể được accept rồi bỏ lại trong backlog; thread kết thúc và `server.requests()` trả hai request, test thất bại đúng. Tuy nhiên, ở các test gọi `requests()` khác, nếu adapter gọi ít hơn số response dự kiến, `join()` chờ `accept()` vô hạn.  
   **Sửa:** thêm thời hạn chờ và cơ chế shutdown cho mock; thiếu request phải gây assertion thất bại hữu hạn.

3. **`models.rs:10` — Khẳng định “Every model returns one image” mạnh hơn bằng chứng.**  
   Tài liệu nói số ảnh đầu ra không luôn tuân theo yêu cầu; điều đó không chứng minh mỗi call luôn đúng một ảnh. Chính `tests.rs:261` đã mô phỏng nhiều ảnh/call. Người bảo trì có thể dựa vào comment này để bỏ hỗ trợ nhiều ảnh.  
   **Sửa:** mô tả đây là chiến lược adapter gọi tuần tự để đáp ứng `outputCount`, không phải bảo đảm của API. [Tài liệu Google](https://ai.google.dev/gemini-api/docs/generate-content/image-generation).

## ĐẠT / điểm tốt

- Request mapping rõ ràng: model path, header key, thứ tự prompt/reference, MIME/base64 và `imageConfig` đều có assertion cụ thể.
- Prompt composition là hàm thuần; giữ đủ bốn phần và bỏ phần rỗng.
- Mapping HTTP đáp ứng bảng yêu cầu; không chuyển nguyên lỗi `reqwest` hoặc body lỗi ra ngoài.
- Timeout cấu hình đúng 180 giây/call generate và 15 giây connection test. Partial failure giữa các call giữ ảnh thành công và đếm lỗi.
- Test thường dùng loopback, không gọi Gemini; live smoke có `#[ignore]`. Chưa có test timeout riêng cho `test_connection`.
- Không thấy model ID bịa: cả năm ID và mốc lifecycle có trong [tài liệu deprecations chính thức](https://ai.google.dev/gemini-api/docs/deprecations). Các giới hạn resolution/reference có cơ sở trong [hướng dẫn ảnh](https://ai.google.dev/gemini-api/docs/generate-content/image-generation); `imageConfig` vẫn được liệt kê trong [REST reference](https://ai.google.dev/api/generate-content). Điều này chưa chứng minh hoạt động live.
- Việc tách `models`/`prompt`/`wire` hợp lý, phù hợp boundary và style hiện có; không sửa services, registry hay frontend.

## Đã chạy

- Đọc brief, Phase 2, ADR-012/013, agent note, provider contract và toàn bộ nội dung thay đổi trong `git diff main...HEAD`.
- Đối chiếu tài liệu Google chính thức.
- `cargo test providers::gemini`: **bị sandbox chặn**, không mở được `target/debug/.cargo-build-lock`, `Access is denied (os error 5)`.
- `cargo clippy --all-targets -- -D warnings`: **bị chặn cùng lỗi**.
- Không chạy live smoke hoặc `cargo fmt --check`. Không sửa, tạo hay commit file.