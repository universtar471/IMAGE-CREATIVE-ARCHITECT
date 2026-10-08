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