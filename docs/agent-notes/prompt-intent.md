# wt/prompt-intent

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-22 23:38

## Muc tieu

Sửa Cải thiện prompt bị kéo theo DNA Japandi/beige dù người dùng nhập phòng khách biệt thự hiện đại, đen trắng chủ đạo.

## Da xong

- Chỉ dẫn AI ưu tiên mọi yêu cầu rõ ràng của người dùng, bao gồm loại phòng/công trình, phong cách, màu chủ đạo, vật liệu, ánh sáng và yêu cầu loại trừ.
- DNA là ngữ cảnh phụ, chỉ dùng khi tương thích; bỏ chi tiết mâu thuẫn thay vì trộn hai phong cách/bảng màu.
- Giữ ngôn ngữ người dùng; thêm chi tiết vừa đủ và kiểm tra không bỏ sót yêu cầu trước khi trả lời.
- Sửa lỗi gợi ý cũ vẫn có thể được nhận sau khi người dùng sửa prompt.
- Đồng bộ tooltip, mock backend và API_CONTRACTS; không đổi schema hay dữ liệu dự án.
- Hai regression test đã được chạy đỏ trước khi sửa: thứ tự ưu tiên prompt/DNA và bỏ preview cũ khi thay đổi prompt.

## Con no

- Chưa merge main, chưa tạo bộ cài mới cho sửa này. Bộ cài bàn giao ở lượt trước chưa chứa thay đổi này.
- Chưa gọi HHTECH thực tế; test kiểm tra yêu cầu gửi model và hành vi giao diện, không khẳng định mọi model luôn tuân thủ ngữ nghĩa.

## Lenh test

- `npm test -- --maxWorkers=2 --testTimeout=15000 --reporter=dot`: 109 files, 1182 tests passed.
- Sau khi đồng bộ mock, chạy lại `npm test -- apps/desktop/tests/extraPrompt.test.tsx --maxWorkers=2 --reporter=dot`: 8 passed.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --jobs 2 -- --test-threads=2`: 370 passed, 6 live tests ignored; main/doctests passed.
- `npm run typecheck`, `npm run lint`, `npm run build -w @arch/desktop`: passed.
- `rustfmt --edition 2021 --check apps/desktop/src-tauri/src/services/prompt_enhance.rs` và `git diff --check`: passed.

## Cam bay da gap

- Không giữ quy tắc cũ “preserve every fact of DNA”: chính nó tạo xung đột với prompt tự nhập. Không chỉ sửa mock hoặc UI.
- Provider test double trả về dòng cuối user message. Giữ prompt người dùng cuối message và đánh nhãn highest priority; ghi DNA trước với nhãn lower priority.
- Frontend build có cảnh báo bundle >500 kB từ trước, không chặn build.

