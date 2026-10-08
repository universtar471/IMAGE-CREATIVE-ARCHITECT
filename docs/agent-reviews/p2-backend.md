# Review P2-A (wt/p2-backend)

## Kết luận: PHẢI SỬA

Có ba vấn đề chặn merge: output hỏng vẫn có thể được ghi thành công, validation lệch §9 và race khi reference bị xóa trước lúc insert generation. Chưa xác nhận được test/clippy do sandbox chặn ghi build lock.

## PHẢI SỬA (chặn merge)

1. **Output chưa decode được vẫn thành `completed`.**  
   **Vị trí:** `apps/desktop/src-tauri/src/services/generations.rs:330`, `apps/desktop/src-tauri/src/services/assets.rs:212`.  
   `imaging::inspect` chỉ dùng `into_dimensions()`, không kiểm tra toàn bộ dữ liệu pixel. Provider trả PNG có header hợp lệ nhưng dữ liệu IDAT hỏng sẽ qua inspection; lỗi decode tại `write_thumbnail` bị nuốt thành `thumbnail_rel = None`. Kết quả là asset `ready`, generation `completed`, nhưng ảnh không mở được. Lỗi ghi thumbnail cũng bị coi thành công, trái yêu cầu failure handling của generation.  
   **Sửa:** decode đầy đủ output trước khi ghi; lỗi decode trả `bad_response`. Tách chính sách thumbnail của import và generation để lỗi ghi file của generation trả `io` và cleanup toàn bộ batch. Thêm test ảnh có header hợp lệ nhưng dữ liệu pixel hỏng và test lỗi ghi thumbnail.

2. **Từ chối giá trị khi model có danh sách capability rỗng, trái §9.**  
   **Vị trí:** `apps/desktop/src-tauri/src/services/generations.rs:181`.  
   `offered` luôn dùng `list.contains(v)`. Với model có `imageSizes: []`, request `imageSize: "1K"` bị `VALIDATION_ERROR`; tương tự `aspectRatios: []`. §9 chỉ yêu cầu kiểm tra membership **khi model có liệt kê lựa chọn**. Agent note và test hiện tại đang củng cố một thay đổi hợp đồng chưa được phản ánh trong tài liệu chuẩn.  
   **Sửa:** dùng điều kiện `list.is_empty() || list.contains(v)` và sửa test tương ứng. Nếu muốn bắt buộc `null`, cần thống nhất thay đổi hợp đồng trước khi merge.

3. **Reference có thể mất sau validation nhưng trước insert, gây lỗi FK hoặc gửi reference đã bị xóa.**  
   **Vị trí:** `apps/desktop/src-tauri/src/services/generations.rs:119`, `apps/desktop/src-tauri/src/services/generations.rs:263`.  
   Sau khi đọc reference bytes và thả mutex, code còn tra key rồi mới lấy mutex để insert. Khoảng này chỉ kiểm tra lại trạng thái project. Nếu `asset_remove` xóa parent, `insert_generation` dùng `parent_asset_id` cũ và trả `DB_ERROR` do FK, thay vì lỗi validation có chủ đích. Nếu reference bị xóa không phải parent, insert vẫn thành công và provider nhận ảnh của asset không còn trong project.  
   **Sửa:** trong cùng vùng khóa với insert, kiểm tra lại toàn bộ reference vẫn tồn tại, thuộc project và `ready`; trả `NOT_FOUND`/`INVALID_STATE` trước khi tạo row nếu đã thay đổi. Thêm test đồng bộ hóa thao tác xóa giữa `prepare` và insert.

## NÊN SỬA

1. **Chưa kiểm chứng rollback khi lỗi SQL hoặc lỗi ghi output giữa batch.**  
   **Vị trí:** `apps/desktop/src-tauri/src/services/generations.rs:742`, `apps/desktop/src-tauri/src/services/generations.rs:874`.  
   Test hiện tại kiểm tra provider error và archive-during-call, nhưng không ép lỗi sau khi đã insert một phần assets/versions, hoặc sau khi đã ghi output đầu tiên. Vì vậy regression bỏ cleanup hay bỏ transaction ở những nhánh này có thể vẫn qua suite.  
   **Sửa:** thêm test dùng SQLite trigger gây lỗi ở output thứ hai và cơ chế giả lập lỗi ghi file; xác nhận assets, versions, generation_outputs rollback hết, originals/previews không còn file và generation là `failed`.

2. **Cleanup bỏ qua lỗi xóa file hoàn toàn.**  
   **Vị trí:** `apps/desktop/src-tauri/src/services/assets.rs:190`.  
   `remove_files` bỏ cả hai kết quả `remove_file`. Trên Windows, nếu file đang bị tiến trình khác giữ với sharing mode không cho xóa, generation thất bại nhưng file orphan còn lại mà không có dấu hiệu để chẩn đoán.  
   **Sửa:** trả hoặc ghi nhận lỗi cleanup bằng asset ID/path, không chứa dữ liệu provider; giữ nguyên lỗi chính và bổ sung test cleanup thất bại.

## ĐẠT / điểm tốt

- Provider call nằm ngoài DB mutex; có test `try_lock` trực tiếp trong provider hook.
- Assets, versions, generation_outputs và trạng thái `completed` được ghi trong một transaction; kiểm tra archive lại trước commit.
- Lineage có `parent_version_id`, `generation_id`, output index; xóa output giữ lịch sử generation nhờ FK cascade đúng hướng.
- DTO đã đối chiếu có tên camelCase, trường nullable và chuỗi enum phù hợp schema; `VersionDto` có `generationId`.
- Request snapshot không lấy key từ `Prepared`; descriptor chỉ trả trạng thái cấu hình. `ResolvedKey` che key trong `Debug`.
- Keyring dùng đúng service/account và bật `windows-native`; lookup ưu tiên keychain rồi env. Các test provider/secrets dùng memory store, không gọi keychain thật.
- Recovery đổi `running` thành `interrupted`; local preview có kiểm tra tính xác định, kích thước, số lượng và blend reference.
- Commands giữ phong cách wrapper mỏng qua `blocking`, nhất quán với code hiện có.

## Đã chạy

- Đã đọc các tài liệu được yêu cầu, schema và toàn bộ diff `main...HEAD`.
- `cargo fmt --check`: **đạt**.
- `cargo test`: **bị chặn**, không mở được `target/debug/.cargo-build-lock`: `Access is denied. (os error 5)`.
- `cargo clippy --all-targets -- -D warnings`: **bị chặn cùng lỗi**.
- Không chạy `npm run verify`.
- Không sửa, tạo hay commit file. `git status --short` không báo thay đổi.
---

# Review P2-A (backend) — vòng 2

## Kết luận: PHẢI SỬA

Cả **3 lỗi chặn và 2 khuyến nghị vòng 1 đã được xử lý** qua đối chiếu code. Tuy nhiên, contract fixture mới có thể gọi Gemini thật bằng API key của môi trường khi chạy test. Chưa xác nhận test/clippy xanh vì sandbox chặn build lock.

## PHẢI SỬA (chặn merge)

1. **Contract fixture chưa cô lập credentials và mạng.**  
   **Vị trí:** [apps/desktop/src-tauri/src/contract_fixtures.rs:171](/D:/IMAGE-CREATIVE-ARCHITECT/apps/desktop/src-tauri/src/contract_fixtures.rs:171), liên quan dòng 137 và [src/secrets.rs:126](/D:/IMAGE-CREATIVE-ARCHITECT/apps/desktop/src-tauri/src/secrets.rs:126).  
   `MemorySecretStore` không vô hiệu hóa env fallback, trong khi fixture đăng ký `GeminiProvider::new()` dùng endpoint thật.  
   **Kịch bản:** máy developer có `ARCH_STUDIO_GEMINI_API_KEY`; chạy `cargo test` khiến ca “gemini has no key” gửi `generateContent` thật, có thể tiêu quota/phát sinh phí. Sau đó `.expect_err(...)` panic vì service trả `Ok(GenerationDto)` cho cả thành công lẫn lỗi provider. Các fixture `configured`/`keySource` cũng phụ thuộc môi trường.  
   **Đề xuất:** inject nguồn env rỗng cho fixture và dùng adapter/transport giả chặn mạng thật. Thêm kiểm tra fixture vẫn ổn định khi tiến trình cha có biến key; tránh sửa env toàn cục giữa các test chạy song song.

## NÊN SỬA

Không có phát hiện bổ sung.

## ĐẠT / điểm tốt

- **Vòng 1 — lỗi 1:** `services/generations.rs:363` decode đầy đủ trước khi ghi; `Thumbnail::Required` khiến lỗi thumbnail thất bại cả batch. Có test PNG hỏng pixel và lỗi thumbnail ở output thứ hai.
- **Vòng 1 — lỗi 2:** validation hiện khớp §9 đã cập nhật: capability list rỗng yêu cầu `null`. `empty_capability_lists_require_null_values` kiểm tra cả từ chối giá trị lẫn chấp nhận `null`.
- **Vòng 1 — lỗi 3:** `services/generations.rs:288` kiểm tra lại mọi reference trong cùng vùng khóa với insert. Test bao phủ xóa master, xóa reference khác và mất file; xác nhận không tạo row, không gọi provider.
- **Vòng 1 — rollback:** test tại `services/generations.rs:1041` và `:1051` ép lỗi ghi output thứ hai và lỗi SQL giữa transaction; kiểm tra sạch assets, versions, generation_outputs và file, giữ generation `failed`.
- **Vòng 1 — cleanup:** `services/assets.rs:193` ghi log và trả lỗi xóa kèm asset ID/path, bỏ qua `NotFound`; có test tương ứng.
- **Monotonic IDs:** `util.rs:13` dùng chung `ulid::Generator` dưới mutex; có test ID và thứ tự assets/versions trong batch.
- **Nâng cấp v1→v2:** `db.rs:165` kiểm tra dữ liệu cũ, FK, `generation_id = NULL` và generation mới nối đúng version của master cũ.

## Đã chạy

- Đối chiếu review vòng 1, agent note, API_CONTRACTS §9 và các thay đổi P2-A trong diff được chỉ định; HEAD là `b1dcfc0`.
- `cargo fmt --check`: **đạt**.
- `cargo test --locked --offline`: **bị chặn** khi mở `target/debug/.cargo-build-lock`, `Access is denied (os error 5)`.
- `cargo clippy --locked --offline --all-targets -- -D warnings`: **bị chặn cùng lỗi**.
- Không gọi Gemini thật để tái hiện; phát hiện dựa trên luồng code.
- Vẫn ở `main`; `git status --short` sạch. Không sửa, tạo hay commit file.