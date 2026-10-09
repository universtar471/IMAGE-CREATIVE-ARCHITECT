# wt/openai-provider

- Agent: claude
- Tách từ: main (b16c772)
- Tạo lúc: 2026-10-09 12:01
- Đề bài: `docs/agent-tasks/openai-provider.md`

## Mục tiêu

Thêm provider `openai` (GPT Image) cạnh `gemini` và `local_preview`: người dùng dán OpenAI API key
và render được. Kèm bài học quota-vs-rate cho Gemini.

## Đã kiểm tra trên tài liệu chính thức (2026-10-09)

`platform.openai.com/docs/...` giờ redirect 301 sang `developers.openai.com/api/docs/...`.

| Nguồn | URL |
|---|---|
| Image generation guide | https://developers.openai.com/api/docs/guides/image-generation |
| `POST /images/generations` | https://developers.openai.com/api/reference/resources/images/methods/generate |
| `POST /images/edits` | https://developers.openai.com/api/reference/resources/images/methods/edit |
| `GET /models/{model}` | https://developers.openai.com/api/reference/resources/models/methods/retrieve |
| Error codes | https://developers.openai.com/api/docs/guides/error-codes |
| Model pages | https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst , `.../gpt-image-2.5-flare`, `.../gpt-image-2` |

Kết quả:

- **Model id hiện hành**: guide nói API dùng `gpt-image-2.5-sunburst` (chính xác khi edit, mạnh nhất)
  và `gpt-image-2.5-flare` (nhanh, dùng hằng ngày); snapshot `...-2026-09-08`. `gpt-image-2`
  (snapshot `gpt-image-2-2026-04-21`) là "earlier model" nhưng vẫn được hỗ trợ. Reference còn liệt kê
  `gpt-image-1.5`, `gpt-image-1`, `gpt-image-1-mini`, `chatgpt-image-latest`; `dall-e-2/3` đã retire
  2026-05-12. App chỉ đưa 3 model: Sunburst, Flare, GPT Image 2.
- **Size**: chuẩn `1024x1024`, `1536x1024`, `1024x1536`, `auto`; với 2 / 2.5 nhận `WIDTHxHEIGHT` tùy ý:
  cạnh chia hết 16, tỉ lệ trong 1:3..3:1, cạnh ≤ 3840, tổng pixel 655,360..8,294,400; "Resolutions above
  2560x1440 are experimental".
- **Quality**: `low|medium|high|auto` cho mọi GPT Image; 2.5 thêm `xhigh`, `max`; mặc định `auto`.
- **n**: 1–10 cho cả generations và edits.
- **Output**: luôn base64 (`data[].b64_json`); `response_format`/`url` không dùng được với GPT Image.
  `output_format` `png` (mặc định) | `jpeg` | `webp`.
- **Reference**: `/images/edits`; curl mẫu trong guide và reference dùng multipart `image[]` (lặp lại
  mỗi ảnh). Reference schema cũng mô tả body JSON `images: [{ image_url | file_id }]`. Tối đa **16 ảnh**
  ("For GPT image models, you can provide up to 16 images"). Mask có (áp lên ảnh đầu), app không dùng.
- **Không có** field seed hay negative prompt. `input_fidelity`: với `gpt-image-2` phải bỏ trống;
  không nói gì cho 2.5 → adapter không gửi.
- **Moderation**: param `moderation` `auto|low` (để mặc định). Bị chặn → `error.type =
  "image_generation_user_error"`, `error.code = "moderation_blocked"` (+ `moderation_details`).
  Guide: không tự retry quota error hay user error.
- **Lỗi**: 401 (key sai / IP / không thuộc org), 403 (vùng không hỗ trợ), 429 rate (`rate_limit_exceeded`
  truyền thống, `slow_down`), 429 billing (`credit_balance_exhausted`,
  `organization_spend_limit_exceeded`, `project_spend_limit_exceeded`,
  `organization_usage_limit_exceeded`; "the broader error.type can still be insufficient_quota"),
  500, 503 `server_is_overloaded`. Shape `{ "error": { message, type, param, code } }`.
- **Organization Verification**: guide: "you may need to complete the API Organization Verification
  from your developer console before using GPT Image models" (link
  platform.openai.com/settings/organization/general).
- **Giá**: 2.5 tính theo token: $8/1M image input, $30/1M image output, $5/1M text input. Bảng cũ
  GPT Image 2 high 1024² ≈ $0.211/ảnh. Rate limit tier Build: 20 ảnh/phút.
- **Latency**: "Complex prompts may take up to 2 minutes".

## Đã xong (commit trên wt/openai-provider)

1. `75b5214` commit đề bài.
2. `207c078` Gemini 429: test trước (đỏ), rồi sửa `gemini/wire.rs`: 429 có `google.rpc.QuotaFailure`
   với violation free-tier (`quotaId` chứa `FreeTier` / `quotaMetric` chứa `free_tier`), `quotaValue
   "0"` hoặc per-day (`PerDay`) → `Auth` (không retry, dừng các output còn lại) + thông báo bật billing
   ở aistudio.google.com. 429 trơn hoặc per-minute trả phí → vẫn `RateLimited`.
3. `58cb204` mock server chuyển sang `providers/test_http.rs` (prefix tùy chỉnh, đọc được body chunked).
4. `f4bac22` `providers/text.rs`: `compose_prompt`, `role_hint`, `sanitize`, `truncate` dùng chung.
5. `7784e9a` adapter `providers/openai/` (`mod.rs`, `models.rs`, `prompt.rs`, `wire.rs`, `tests.rs`),
   reqwest bật feature `multipart`.
6. `aa3b711` đăng ký `gemini, openai, local_preview`; fixture trỏ openai về `127.0.0.1:9`; regenerate
   `provider_list.json`; test env fallback `ARCH_STUDIO_OPENAI_API_KEY`.
7. `8ba28da` UI: mock backend có openai; test so `MOCK_PROVIDERS` với fixture Rust; dialog có help
   theo provider (`features/providers/help.ts`).
8. `3cd1a7c` README.

## Quyết định tự chốt

- **Multipart thay vì JSON cho edits**: brief yêu cầu, và là dạng mọi ví dụ chính thức dùng. Thứ tự
  `image[]` = thứ tự reference; prompt đánh số vai trò từng ảnh theo thứ tự đó.
- **imageSizes = `1K`, `2K`** (API không có tier, adapter map ratio + tier → pixel, bảng `SIZES` trong
  `openai/models.rs`, test kiểm mọi ràng buộc). 1K dùng size chuẩn của docs khi có; 2K ≤ số pixel
  2560x1440 (vuông = 1920x1920) để tránh vùng experimental. **Không có 4K**.
  Không chọn gì → bỏ `size` (API auto). Chỉ ratio → 1K; chỉ tier → 1:1.
- **aspectRatios**: 10 tỉ lệ như Gemini standard (1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9).
- **quality luôn `high`**: `auto` trên 2.5 có thể chọn `xhigh/max` (chậm, đắt, khó đoán). Nếu cần chọn
  quality trong UI phải thêm field vào contract — để sau.
- **output_format `png`**; mime lấy theo `output_format` trả về.
- **n trong 1 request** (không gọi tuần tự như Gemini). Trả ít hơn n → nhận phần có, meta ghi
  `requested/returned`; nhiều hơn → cắt.
- **429 billing → `Auth`** (không retry; kind sẵn có, UI đã xử lý "đi tới provider settings").
  Brief cho phép Auth hoặc InvalidRequest; chọn Auth vì sửa ở tài khoản, không phải ở request.
- **403 → `Auth`**, message nhắc Organization Verification + vùng không hỗ trợ, kèm detail vendor.
- **Blocked**: `moderation_blocked` hoặc `content_policy_violation` (code cũ) ở mọi 4xx (trừ
  401/403/429 đã xử lý trước).
- **test_connection**: `GET /v1/models/gpt-image-2.5-sunburst`, đòi `object == "model"` và `id`
  là string. Không kiểm được Organization Verification hay billing (model list vẫn trả 200) → message
  OK nhắc điều này.
- Timeout: generate 300 s, test 15 s.
- Dialog: URL hiện dạng text (webview không mở link ngoài), không phải `<a>`.

## Chưa kiểm chứng được

- Không có `ARCH_STUDIO_OPENAI_API_KEY` trong môi trường → **chưa chạy live**. Shape lỗi 403 khi org
  chưa verify và chuỗi `code` của 429 rate (`rate_limit_exceeded`) là theo thông lệ, docs error-codes
  không ghi rõ; mapping dựa vào status nên vẫn đúng kind.
- Giới hạn dung lượng mỗi ảnh multipart: guide chỉ nói "< 50MB" trong phần mask; data URL tối đa
  20 MB. Adapter không kiểm.
- Định dạng ảnh input được nhận (png/jpeg/webp) không thấy ghi trong trang đã đọc; app gửi đúng
  mime của asset.
- Gemini: shape `QuotaFailure` lấy theo `google.rpc` chuẩn + run thật mô tả trong brief, không có mẫu
  trong docs Gemini.

## Lệnh test

```bash
npm install                       # một lần, ở gốc worktree
npm run verify                    # typecheck, lint, vitest, cargo test
cd apps/desktop/src-tauri
cargo clippy --all-targets -- -D warnings
cargo fmt --check
cd ../../.. && npx prettier --check .
# fixture: UPDATE_BACKEND_FIXTURES=1 cargo test contract_fixtures   (trong src-tauri)
# live (tốn 1 ảnh, không in key):
ARCH_STUDIO_OPENAI_API_KEY=<key> cargo test openai_live -- --ignored --nocapture
# tùy chọn ARCH_STUDIO_OPENAI_MODEL=gpt-image-2.5-flare
```

Kết quả lần cuối: vitest 17 file / 242 test xanh; cargo 167 pass, 2 ignored (2 live smoke); clippy,
fmt, prettier sạch.

## Còn nợ

- Live smoke OpenAI (cần key + credit + có thể cần Organization Verification).
- Chọn quality / 4K trong UI (cần mở rộng `GenerationParams`).

## Cạm bẫy đã gặp

- WebFetch hỏng (model lỗi) → tải docs bằng curl; trang `developers.openai.com/...` có bản `.md`
  (thêm `.md`) cho model pages / error codes, nhưng reference images thì không (404) → đọc HTML.
- Hai module test cùng `impl MockServer { fn provider() }` → trùng tên; dùng trait cục bộ
  `MockProvider` trong mỗi `tests.rs`.
- Python trên Windows ghi file ở text mode thành CRLF; `.gitattributes` ép LF nên git tự chuẩn hóa,
  nhưng nên ghi với `newline=''`.
