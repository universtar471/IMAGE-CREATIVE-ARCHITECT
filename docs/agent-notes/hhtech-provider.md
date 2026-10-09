# wt/hhtech-provider

- Agent: claude
- Tách từ: wt/openai-provider
- Tạo lúc: 2026-10-09 12:20
- Đề bài: `docs/agent-tasks/hhtech-provider.md`

## Mục tiêu

Provider `hhtech` (gateway OpenAI-compatible, ảnh + chat chung một base URL) dùng lại adapter
OpenAI; lệnh `prompt_enhance` + nút "Enhance prompt" trong Generate; nạp `.env` lúc khởi động.
Kèm sửa review Codex vòng 1 của openai-provider (bỏ 1K/2K).

## Đã xong (commit trên wt/hhtech-provider)

1. `d2a3506` commit đề bài.
2. `1794da0` **review fix** "OpenAI: drop invented 1K/2K size tiers": `imageSizes` rỗng cho openai,
   bảng `SIZES` còn 1 size/ratio (size chuẩn của docs khi có), không ratio → bỏ `size`. Mock, fixture,
   README, note openai cập nhật.
3. `7e126c2` backend:
   - `providers/openai/` nhận `Config` (id, label, vendor, base URL `Result`, models, default size,
     quality, chat model, setup hint) + `Flavor::{Official, Gateway}`. openai giữ nguyên hành vi.
   - Gateway: JSON `{model,prompt,size,quality,n,response_format:"b64_json"}`; 400 có chữ
     `response_format` → gửi lại 1 lần không có field đó; edits multipart, 1 ảnh = `image`, nhiều =
     `image[]`; `data[].url` → tải về (`openai/download.rs`: https, http chỉ loopback, không gửi
     Authorization, cap 50 MB, timeout 300 s, mime từ header hoặc magic bytes); lỗi JSON OpenAI /
     `{error:"…"}` / `{message}` / `{detail}` / text thô → message luôn có `HTTP <status>` + "HHTECH
     says: …" (key redacted, HTML không trích); test = `GET /models` (báo model cấu hình có/không
     trong list; 404 → ok kèm giải thích); chat `POST /chat/completions` timeout 60 s, đọc
     `choices[0].message.content` (string hoặc mảng parts).
   - `providers/hhtech/mod.rs`: config từ `EnvSource` (`HHTECH_BASE_URL` bắt buộc, trim `/`, https
     hoặc http loopback; model list phẩy, dedupe; size `WxH` hoặc `auto`; quality 1 từ; chat model).
     Setting sai → `config_problem` (provider "not configured", không gọi mạng), model list vẫn có
     default để Zod `min(1)` qua.
   - Trait `ImageProvider` thêm `config_problem`, `chat_model`, `chat` (có default).
     `provider_settings::key_for` trả None khi có config problem → generations.rs không phải sửa
     (vẫn chặn submit với `PROVIDER_NOT_CONFIGURED`, message nêu `HHTECH_BASE_URL`). Descriptor
     `configured=false` nhưng `keySource` vẫn báo key ở đâu.
   - `secrets::env_var_names`: hhtech đọc `HHTECH_API_KEY` rồi `ARCH_STUDIO_HHTECH_API_KEY`
     (keychain vẫn thắng).
   - `env_file.rs` (dotenvy, không override, chỉ in path): `ARCH_STUDIO_ENV_FILE` → `.env` ở CWD →
     (dev build) các thư mục cha + repo root theo `CARGO_MANIFEST_DIR`. Gọi đầu `run()`.
   - `services/prompt_enhance.rs` + command `prompt_enhance`; ErrorCode mới `PROVIDER_ERROR`
     (details `{providerId, kind, retryable}`). TestProvider có `chat`.
   - Fixture: hhtech trỏ `http://127.0.0.1:9/v1` qua `FixedEnv` (không đọc env thật); thêm
     `prompt_enhance.json`, `error_prompt_enhance_not_configured.json`,
     `error_prompt_enhance_provider.json` (connection refused ở loopback).
   - `test_http::Reply::Raw(status, content_type, bytes)` cho text/plain và tải ảnh.
4. `1e11953` domain/bridge/mock: Zod `PromptEnhanceRequest/Result`, `PROVIDER_ERROR`; mock có hhtech +
   `prompt_enhance` tất định (`mockEnhance`); help dialog cho hhtech.
5. `1f47ff1` UI: `ExtraPromptSection` (textarea "Extra prompt" trong draft, nối vào cuối positive
   prompt khi submit qua `withExtraPrompt`; store bỏ `extraPrompt` khỏi request). Enhance: flush DNA →
   compile → context = positive + preservation → spinner → preview Accept/Discard → Accept có Undo.
   Disabled + tooltip khi HHTECH chưa cấu hình / trống / archived.
6. `8dfb194` README (HHTECH, `.env`, live tests), API_CONTRACTS §11 + §1, `.env.example`.

## Giả định về gateway (không đọc được docs HHTECH)

Fact do lead gọi thật (2026-10-09, `https://hhtechapi.com/v1`): `/models` trả list OpenAI 128 model;
gateway mã hoá tier/edit trong model id (`gpt-image-2-2k`, `gpt-image-2-edit-1k`…) — app chỉ liệt kê
id trong `HHTECH_IMAGE_MODEL` (không hardcode list); chat `claude-sonnet-5` chuẩn; generations
`b64_json` ~100 s, PNG ~3 MB; edits với 1 field `image` ~36 s, có `revised_prompt` (bỏ qua).

Chưa kiểm chứng: field cho **nhiều** reference (`image[]`), `maxReferenceImages` = 16 (lấy theo GPT
Image, gateway có thể giới hạn khác), shape lỗi thật của gateway, nhánh url fallback và retry
`response_format` (chỉ test bằng mock), `quality` khác `medium`.

## Lệnh test

```bash
npm install && npm run verify          # gốc worktree
cd apps/desktop/src-tauri
cargo fmt --check && cargo clippy --all-targets -- -D warnings
cd ../../.. && npx prettier --check .
# fixture (không chạm mạng): UPDATE_BACKEND_FIXTURES=1 cargo test contract_fixtures   (trong src-tauri)
# live (chưa chạy — người dùng/lead chạy):
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml hhtech_live -- --ignored --nocapture
```

Live test đọc `.env` qua `env_file::load_dotenv()`; từ worktree thì `.env` của repo chính không nằm
trên đường đi lên → đặt `ARCH_STUDIO_ENV_FILE=D:/IMAGE-CREATIVE-ARCHITECT/.env` hoặc chạy ở repo chính
sau khi merge. Ảnh lưu `%TEMP%/hhtech-live-<ulid>/`, đường dẫn in ra.

Kết quả lần cuối: vitest 18 file / 252 test xanh; cargo 194 pass, 5 ignored (2 live cũ + 3 live
hhtech); fmt, clippy, prettier sạch.

## Còn nợ

- Chạy 3 live test; nếu multi-reference không nhận `image[]` thì đổi field hoặc hạ `maxReferenceImages`.
- Chưa xem UI bằng mắt (chỉ test component bằng testing-library).
- Có thể thêm "refresh models từ /models" cho HHTECH (lead gợi ý, để sau).

## Cạm bẫy đã gặp

- Heredoc python nhiều dòng trong Bash tool hay vỡ quote → ghi script ra scratchpad rồi chạy.
- `store.ts` / `generations.rs` đang bị `p3-fixes` sửa: store chỉ đổi ~10 dòng (type draft + strip
  `extraPrompt` + `withExtraPrompt`), generations.rs không đổi.
