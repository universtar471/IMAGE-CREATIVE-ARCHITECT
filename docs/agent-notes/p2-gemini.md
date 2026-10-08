# wt/p2-gemini — P2-B Gemini image adapter

- Agent: Claude Code
- Tách từ: `main` @ 3ead73d
- Đề bài: `docs/agent-tasks/p2-gemini.md`
- File sở hữu: `apps/desktop/src-tauri/src/providers/gemini/` (thay cho `gemini.rs`, xem "Cạm bẫy").
  Không đụng `providers/mod.rs`, services, commands, registry, frontend. Không thêm dependency.

## Mục tiêu

Adapter `GeminiProvider` thật cho trait `ImageProvider`: gọi Gemini `generateContent`,
capability trung thực theo docs, map lỗi về `ProviderErrorKind`, test không cần mạng.

## Đã xong

| File | Nội dung |
|---|---|
| `gemini/mod.rs` | provider: `generate` (gọi tuần tự theo `outputCount`), `test_connection` (GET metadata model), validate, timeout |
| `gemini/models.rs` | bảng 5 model + capability |
| `gemini/prompt.rs` | `compose_prompt`, `reference_label` (hàm thuần, có unit test) |
| `gemini/wire.rs` | dựng body JSON, parse response, map lỗi HTTP / finishReason, redact key |
| `gemini/tests.rs` | mock HTTP server bằng `std::net::TcpListener` + 1 test live `#[ignore]` |

Test: 24 test gemini (+1 ignored); toàn crate 52 passed, 1 ignored. `cargo clippy --all-targets -- -D warnings`
và `cargo fmt --check` sạch.

## API đã xác minh (2026-10-08)

Nguồn chính thức (tải bằng curl, đọc ngày 2026-10-08):

- Hướng dẫn ảnh, bản `generateContent`: https://ai.google.dev/gemini-api/docs/generate-content/image-generation
- Hướng dẫn ảnh, bản Interactions (trang mặc định): https://ai.google.dev/gemini-api/docs/image-generation
- REST reference `generateContent`: https://ai.google.dev/api/generate-content
- REST reference `models.get`: https://ai.google.dev/api/models
- Vòng đời model: https://ai.google.dev/gemini-api/docs/deprecations
- Tình trạng Interactions API: https://ai.google.dev/gemini-api/docs/interactions-overview

Wire shape dùng trong code:

- `POST {base}/models/{model}:generateContent`, base = `https://generativelanguage.googleapis.com/v1beta`
- header `x-goog-api-key` (key KHÔNG nằm trong URL)
- `contents[0].parts` = text prompt đã ghép → với mỗi reference: text label + `inlineData {mimeType, data(base64)}`, giữ thứ tự
- `generationConfig.responseModalities = ["TEXT","IMAGE"]`
- `generationConfig.imageConfig = { aspectRatio, imageSize }` (chỉ gửi trường đã set)
- response: `candidates[].content.parts[].inlineData {mimeType, data}`; bỏ part có `"thought": true`
- `promptFeedback.blockReason`, `candidates[].finishReason` (enum có `IMAGE_SAFETY`, `IMAGE_PROHIBITED_CONTENT`, `NO_IMAGE`, `IMAGE_OTHER`, `IMAGE_RECITATION`...)
- `test_connection` = `GET {base}/models/gemini-nano-banana-2.1` (timeout 15 s), không sinh ảnh

Model và capability (`max_outputs` = 4 cho tất cả vì mỗi call 1 ảnh → gọi tuần tự; negative prompt = false; seed = false):

| Model id | Tình trạng (deprecations) | Aspect ratios | Image sizes | Max refs |
|---|---|---|---|---|
| `gemini-nano-banana-2.1` (mặc định) | ra 2026-10-06, chưa có ngày tắt | 14: 1:1 1:4 1:8 2:3 3:2 3:4 4:1 4:3 4:5 5:4 8:1 9:16 16:9 21:9 | 1K 2K 4K | 14 |
| `gemini-3-pro-image` | ra 2026-05-28 | 10: 1:1 2:3 3:2 3:4 4:3 4:5 5:4 9:16 16:9 21:9 | 1K 2K 4K | 14 |
| `gemini-3.1-flash-image` | ra 2026-05-28, docs khuyên chuyển sang 2.1 | 14 (như trên) | 512 1K 2K 4K | 14 |
| `gemini-3.1-flash-lite-image` | ra 2026-06-30 | 10 | 1K | 14 |
| `gemini-2.5-flash-image` (legacy) | **tắt 2027-03-15** | 10 | rỗng (cỡ cố định ~1K) | 3 |

- `imageSize` phải viết hoa `K`; `512` không có hậu tố (trang generateContent). Gửi `1k` sẽ bị từ chối.
- 2.5 Flash: `image_sizes` rỗng = "provider tự quyết" theo `ModelCapabilitiesSchema`; adapter **từ chối** nếu
  request có `imageSize` cho model này (reference: "An error will be returned if this field is set for models that
  don't support these config options").
- Các model preview cũ (`gemini-3-pro-image-preview`, `gemini-3.1-flash-image-preview`,
  `gemini-2.5-flash-image-preview`) đã tắt từ 2026-06-25 / 2026-01-15 → không đưa vào.

## Không xác minh được / điểm docs tự mâu thuẫn

1. **Interactions API là hướng mới.** Từ 06/2026 Google khuyên dùng `POST /v1beta/interactions`; `generateContent`
   là "legacy" nhưng "remains fully supported". Adapter giữ `generateContent` như đề bài. Nếu một ngày Google
   ngừng `generateContent`, chỉ cần sửa `wire.rs` + `mod.rs`.
2. **`imageConfig` hay `responseFormat.image`?** REST reference v1beta vẫn liệt kê
   `GenerationConfig.imageConfig {aspectRatio, imageSize}` (string). Nhưng ví dụ curl trong guide dùng `/v1/` và
   `generationConfig.responseFormat.image {aspectRatio, imageSize}`. Adapter dùng `imageConfig` trên `v1beta`
   (có trong reference, không ghi deprecated). Nếu test live báo lỗi field này → đổi sang `responseFormat.image`.
3. **Gemini 3.1 Flash Lite Image**: bảng aspect ratio trang generateContent ghi 14 tỉ lệ + cột 512, nhưng phần
   features ghi "only supports 1K" và chỉ liệt kê 10 tỉ lệ. Adapter lấy giá trị hẹp: 10 tỉ lệ, chỉ `1K`.
4. **Gemini 3 Pro Image**: tiêu đề bảng ghi "3.1 Pro Image" nhưng id model ở mọi chỗ khác là `gemini-3-pro-image`.
5. **Giới hạn reference**: docs ghi "up to 14 reference images" cho 3 Pro / 3.1 Flash / 2.1 / Lite (độ trung thực
   object 6–14 tuỳ model, Lite "not optimized for multiple reference inputs"). 2.5 Flash chỉ có "works best with
   up to 3" — không phải giới hạn cứng, adapter đặt 3.
6. **Seed**: `GenerationConfig.seed` tồn tại nhưng docs ảnh không nói model ảnh tôn trọng seed → `supports_seed=false`,
   seed bị bỏ qua.
7. Kích thước tối đa / số MB inline của reference không kiểm tra trong adapter (docs trỏ sang trang Image
   understanding). Payload > giới hạn sẽ về 400 → `InvalidRequest` có kèm thông điệp ngắn của Google.
8. **Chưa chạy test live** (máy không có `ARCH_STUDIO_GEMINI_API_KEY`). Mọi khẳng định trên là theo docs.

## Hành vi cần biết (cho P2-A / P2-C)

- `generate` validate trước khi gọi mạng → `InvalidRequest` nếu: model lạ, `outputCount` ngoài 1..4, quá số
  reference, aspect ratio / image size không có trong capability, prompt rỗng. Thiếu key → `Auth`.
  P2-A nên validate cùng luật bằng `ProviderInfo::model()` để lỗi về sớm thành `AppError`, nhưng không bắt buộc.
- P2-C: model có `imageSizes` rỗng → gửi `imageSize: null`. Đừng mặc định "1K" cho mọi model.
- Partial failure: trả ảnh thành công, `meta = { model, modelVersion, requested, returned, failed, errors:[{kind,message}],
  finishReasons, text }`. Không ảnh nào → trả lỗi của call cuối. `Auth`/`InvalidRequest` dừng ngay, không gọi tiếp.
- Map lỗi: 401/403 → `Auth`; 400 + reason `API_KEY_INVALID` (hoặc message "API key not valid/expired") → `Auth`;
  400 khác, 404 → `InvalidRequest`; 429 → `RateLimited`; 5xx + lỗi kết nối → `Network`; client timeout → `Timeout`;
  `blockReason` hoặc finishReason SAFETY/PROHIBITED_CONTENT/BLOCKLIST/SPII/RECITATION/IMAGE_* (trừ NO_IMAGE,
  IMAGE_OTHER) → `Blocked`; 200 không ảnh → `BadResponse` kèm ≤200 ký tự text của model.
- Message không bao giờ chứa key (key được thay bằng `[redacted]` nếu Google echo lại), không dump body thô;
  văn bản từ Google bị cắt ≤200 ký tự.
- Adapter blocking, tự đặt timeout (generate 180 s, test 15 s) — gọi trong `spawn_blocking` như ADR-014.
- Trait trong `providers/mod.rs` đủ dùng, không cần đổi.

## Lệnh test

```bash
cd apps/desktop/src-tauri
cargo test gemini                      # 24 test, không mạng
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

Test live (tốn 1 lần sinh ảnh, chạy tay):

```bash
cd apps/desktop/src-tauri
ARCH_STUDIO_GEMINI_API_KEY=<key> cargo test gemini_live -- --ignored --nocapture
# đổi model: thêm ARCH_STUDIO_GEMINI_MODEL=gemini-3-pro-image
```

PowerShell: `$env:ARCH_STUDIO_GEMINI_API_KEY='<key>'; cargo test gemini_live -- --ignored --nocapture`.
Test không in key; chỉ in dòng trạng thái và `meta`.

## Cạm bẫy đã gặp

- `gemini.rs` đã chuyển thành thư mục `gemini/` (đề bài cho phép). `providers/mod.rs` vẫn `pub mod gemini;` nên
  không cần sửa — khi merge với P2-A, nếu nhánh kia có sửa `providers/gemini.rs` sẽ thành conflict delete/modify.
- Trang `ai.google.dev/gemini-api/docs/image-generation` hiện mặc định hiển thị Interactions API (`/v1beta/interactions`,
  `response_format`, snake_case). Bản generateContent nằm ở `/gemini-api/docs/generate-content/image-generation`.
- WebFetch trong phiên này lỗi; docs được tải bằng `curl` rồi bóc text.
- Mock server: trả `Connection: close` để mỗi call tuần tự mở kết nối mới; khi test cần mở khoá `accept()` còn treo,
  connect rỗng một lần (server bỏ qua kết nối không có request line).
- `reqwest::blocking` mặc định timeout 30 s — phải đặt rõ 180 s cho generate.
