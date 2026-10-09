# Review openai-provider — vòng 1

## Kết luận: PHẢI SỬA

## PHẢI SỬA (chặn merge)

- **`apps/desktop/src-tauri/src/providers/openai/models.rs:27,87`** — Provider công bố `1K` và `2K` như các `imageSizes` được hỗ trợ, rồi tự ánh xạ chúng sang kích thước pixel ở dòng 37–48. Nhưng API nhận kích thước `WIDTHxHEIGHT` tùy ý; `1K`/`2K` không phải các tier chính thức. Hậu quả là UI và contract hứa một lựa chọn tier mà API không định nghĩa, trái yêu cầu chỉ công bố tier có thật. Hãy bỏ `1K`/`2K` khỏi `image_sizes` (và cập nhật mock ở **`apps/desktop/src/lib/mockBackend.ts:168`**); giữ `imageSize: null` theo contract, còn kích thước gửi API có thể được chọn từ aspect ratio hoặc để API tự chọn. Cập nhật kiểm thử capabilities và ánh xạ size tương ứng.

## NÊN SỬA

- Không có phát hiện bổ sung.

## ĐẠT / điểm tốt

- Tách đúng endpoint: không có ảnh tham chiếu dùng `POST /images/generations` với JSON; có ảnh tham chiếu dùng `POST /images/edits` với multipart và các trường `image[]` theo thứ tự request.
- Decode `data[].b64_json`; phản hồi thiếu ảnh hoặc base64 sai được phân loại `BadResponse`.
- Phân loại 401/403, quota billing 429 không retry, rate limit 429 retry, moderation thành `Blocked`, 5xx thành `Network`, timeout thành `Timeout`. Gemini cũng phân biệt quota miễn phí/per-day đã cạn với rate limit; có test cho cả hai trường hợp.
- Các đường tạo message/meta và xử lý lỗi không chuyển tiếp raw response hay lỗi reqwest. API key được gửi qua Bearer auth; không thấy đường ghi key vào DTO, SQLite hoặc log.
- Mock HTTP server dùng listener loopback; fixture OpenAI trỏ tới `127.0.0.1:9`, nên không gọi API thật. Mock backend và fixture phản ánh provider OpenAI; help theo provider có hướng dẫn API key và billing.

## Đã chạy

- `git diff --check b16c772 HEAD` — không báo lỗi.
- Đã đọc diff, brief, note, ADR-012/013, API Contracts §9–10 và đối chiếu tài liệu OpenAI chính thức. **Không chạy test/build trong lượt review này.**