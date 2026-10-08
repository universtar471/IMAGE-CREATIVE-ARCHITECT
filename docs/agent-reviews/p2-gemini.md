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
---

# Review P2-B (wt/p2-gemini) — vòng 2

## Kết luận: ĐẠT

Hai lỗi chặn merge vòng 1 đã được sửa trong `29f7219`, có test hồi quy đúng tình huống. `7cd70f1` cập nhật bàn giao. Không phát hiện regression chặn merge qua đọc mã; chưa xác nhận test/clippy xanh vì sandbox chặn Cargo.

Các đường dẫn `gemini/*` dưới đây tính từ `apps/desktop/src-tauri/src/providers/`.

## PHẢI SỬA (chặn merge)

Không có.

## NÊN SỬA

1. **`gemini/mod.rs:22`, `docs/agent-notes/p2-gemini.md:49` — vẫn khẳng định mỗi call trả một ảnh.**  
   `models.rs:10` đã sửa nhưng hai chỗ này còn mô tả như bảo đảm của API. Khi một response có nhiều ảnh, tài liệu mâu thuẫn với chính parser và có thể khiến người bảo trì bỏ hỗ trợ đó. **Sửa:** thống nhất mô tả đây là chiến lược gọi tuần tự, chấp nhận nhiều ảnh/call và giới hạn tổng bằng `outputCount`. Google không bảo đảm số ảnh luôn đúng yêu cầu. [Hướng dẫn chính thức](https://ai.google.dev/gemini-api/docs/generate-content/image-generation).

2. **`gemini/tests.rs:298` — chưa chứng minh giữ được nhiều ảnh từ cùng một response.**  
   Test đưa vào hai ảnh nhưng yêu cầu `outputCount=1`; parser bị regression chỉ giữ ảnh đầu vẫn vượt qua test. **Sửa:** thêm ca `outputCount=2`, một response chứa hai ảnh; assert đủ hai bộ bytes và đúng một HTTP request.

3. **`gemini/tests.rs:411`, `gemini/mod.rs:248` — thiếu test timeout riêng cho `test_connection`.**  
   Test hiện tại chỉ thay `generate_timeout`. Nếu GET metadata dùng nhầm timeout generate, bộ test vẫn xanh dù kiểm tra kết nối có thể chờ 180 giây. **Sửa:** thêm mock phản hồi chậm, đặt `test_timeout` ngắn và assert `Timeout`; kiểm tra riêng giá trị mặc định 15/180 giây.

## ĐẠT / điểm tốt

- **PHẢI 1 vòng 1:** `wire.rs:76` nhận key và sanitize text, `modelVersion`, `finishReason`, `blockReason` trước khi đưa vào message/meta; validation cũng được che key. Test tại `tests.rs:467–523` bao phủ lỗi, thành công và partial failure. Live smoke không còn in toàn bộ `meta`.
- **PHẢI 2 vòng 1:** `wire.rs:95` xét từng candidate, loại ảnh của candidate bị chặn và giữ ảnh hợp lệ. Test tại `tests.rs:529`, `tests.rs:540` kiểm tra cả candidate bị chặn đứng sau và candidate bị chặn vẫn chứa ảnh.
- **NÊN 1 vòng 1:** GET metadata đã từ chối HTML, `{}`, `name` sai kiểu/sai dạng; có test tương ứng.
- **NÊN 2 vòng 1:** mock có non-blocking accept, deadline, read timeout và shutdown khi lấy request/drop; đã loại tình huống `join()` chờ `accept()` vô hạn.
- **NÊN 3 vòng 1:** comment tại `models.rs` đã sửa đúng; còn hai bản mô tả chưa đồng bộ nêu trên.
- Request mapping, thứ tự reference, MIME/base64, prompt composition và HTTP error mapping phù hợp brief. Partial failure giữa các call giữ ảnh thành công và ghi số call lỗi.
- Năm model ID có trong [bảng lifecycle Google](https://ai.google.dev/gemini-api/docs/deprecations). Capability có cơ sở trong hướng dẫn ảnh; `imageConfig` vẫn có trong [REST reference](https://ai.google.dev/api/generate-content). Không thấy ID bịa; hoạt động live vẫn chưa được chứng minh.
- Test thường dùng loopback, live smoke có `#[ignore]`. Cấu trúc module và cách dùng provider contract phù hợp mã xung quanh; không thay services, registry hay frontend.

## Đã chạy

- Đọc review vòng 1 trên `main`, brief, Phase 2, ADR-012/013, agent note, provider contract, toàn bộ thay đổi `main...HEAD` và hai commit sửa.
- Đối chiếu tài liệu Google chính thức.
- `cargo test providers::gemini`: **bị chặn**, không mở được `target/debug/.cargo-build-lock`: `Access is denied (os error 5)`.
- `cargo clippy --all-targets -- -D warnings`: **bị chặn cùng lỗi**.
- `cargo fmt --check`: **đạt**.
- `git diff --check main...HEAD`: **đạt**.
- Không chạy live smoke. Không sửa, tạo hay commit file; `git status --short` không báo thay đổi.