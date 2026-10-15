# IMAGE-CREATIVE-ARCHITECT — Color Grading Studio V5.3

**Ngày:** 15/10/2026  
**Phạm vi:** Tiếp nối Color Grading V5.2, thêm Batch Color Grading, không thay đổi Project DNA hoặc nguồn ảnh.  
**Tình trạng:** Bản vá TypeScript/React đã tạo; thử nghiệm hàm xử lý queue và kiểm tra cú pháp TypeScript thành công. Chưa chạy được typecheck/Vitest/Rust toàn repo do môi trường thiếu dependency (nhiều thư mục `node_modules` rỗng; `npm install` không hoàn thành).

## 1. Giữ nguyên tính năng V5.2

- 30 preset màu chia sáu nhóm: tự nhiên, ấm, lạnh, editorial, cinematic, đặc biệt.
- Thư viện thumbnail tạo từ pixel thật của ảnh dự án, không phải ảnh stock.
- Canvas Before / After / Split; bộ chỉnh Exposure, Contrast, Highlights, Shadows, Whites, Blacks, Temperature, Tint, Vibrance, Saturation, Clarity, Dehaze.
- Xử lý màu không tạo sinh; không yêu cầu API AI; giữ nguyên kích thước, tỷ lệ, bố cục và dữ liệu kiến trúc ở mức hình học.
- Lưu kết quả dạng asset/version mới, không ghi đè ảnh nguồn.

## 2. Bổ sung V5.3 — Batch Color Grading

**Lối vào:** Workspace → Mood / Grade → **Áp màu hàng loạt** / Batch colour grade.

### 2.1. Màn hình chọn ảnh

- Hiển thị thumbnail thật và tên các ảnh thuộc dự án hiện tại.
- Mặc định nhóm “Ảnh AI đã tạo / đã chỉnh màu”; chuyển sang “Ảnh gốc” hoặc “Tất cả ảnh dự án”.
- Tìm theo tên, mã ảnh, `source`, hoặc `operation`; không suy đoán phòng/khu vực từ tên ảnh.
- Chọn/bỏ chọn từng ảnh, chọn/bỏ chọn toàn bộ ảnh **đang lọc**, bỏ chọn tất cả.
- Số ảnh đã chọn hiển thị liên tục; chọn ảnh từ bộ lọc này không xóa lựa chọn từ bộ lọc khác.
- Hiển thị tối đa 48 thumbnail mỗi trang nạp; nút “Xem thêm” cho dự án lớn. Các ảnh full-size **không** được nạp để dựng lưới.

### 2.2. Chọn màu và preview

- Chọn một trong 30 preset, chỉnh cường độ từ 0–100%.
- Có thể mở thư viện 30 thumbnail trên ảnh thật và xem một ảnh lớn Before / After / Split.
- Chọn ảnh bất kỳ làm ảnh xem trước.
- Cường độ được quy đổi thành giá trị ColorGradeDNA để dùng chung pipeline JS preview và Rust `grade_apply` (không phải một bộ lọc CSS giả lập).
- Preview cảnh báo rằng ảnh có ánh sáng nguồn khác nhau sẽ phản ứng màu khác nhau.

### 2.3. Xử lý hàng loạt

- Tạo danh sách ID ảnh từ lựa chọn hiện tại; loại ID trùng.
- Xử lý **tuần tự** qua `grade_apply` (đã tồn tại), một ảnh full-size mỗi lần; không gửi AI API.
- Mỗi ảnh thành công được lưu ngay lập tức bằng asset mới + version con của ảnh nguồn.
- Thất bại của một ảnh không dừng toàn bộ batch. Hiển thị số thành công, số lỗi và lỗi từng ảnh.
- Có nút dừng **sau ảnh đang xử lý**. Không hủy giữa transaction ghi file/DB.
- Có “Tiếp tục” cho ảnh chưa được xử lý nếu người dùng dừng giữa batch, và “Thử lại lỗi” chỉ cho ảnh thất bại.
- Sau batch, gọi `asset_list` **một lần** để đồng bộ thư viện, không tải lại toàn bộ mỗi ảnh.
- Đóng dialog lúc đang chạy sẽ yêu cầu dừng và giữ dialog mở đến khi lần ghi hiện tại hoàn thành.

### 2.4. Quy tắc an toàn

- Không tự tạo/xóa xe, người, cây, vật liệu, cửa, mái, đồ nội thất.
- Color grade ảnh hưởng cảm nhận màu; không có cơ chế lock vật liệu theo từng pixel ở V5.3. Nếu cần giữ đúng màu đã duyệt, sử dụng preview và tránh preset quá mạnh.
- Không crop, resize, upscale; các tác vụ đó thuộc module riêng.
- Dự án read-only/archived không được xử lý.
- Chức năng độc lập Project DNA: chọn grade cho batch **không ghi đè** `draftDna.colorGrade`.

## 3. Cấu trúc mã nguồn thay đổi

| File | Loại | Công việc |
|---|---|---|
| `apps/desktop/src/features/mood/batchGrade.ts` | Mới | Lọc, chọn, cường độ, job runner tuần tự, lỗi, cancellation |
| `apps/desktop/src/features/mood/BatchGradeDialog.tsx` | Mới | Giao diện chọn ảnh thật, preview, preset, tiến độ, retry |
| `apps/desktop/src/features/mood/MoodGradePanel.tsx` | Sửa | Thêm nút Áp màu hàng loạt |
| `apps/desktop/src/styles/app.css` | Sửa | Responsive thumbnail grid và trạng thái batch |
| `apps/desktop/src/i18n/en.ts` | Sửa | Nhãn điều hướng tiếng Anh |
| `apps/desktop/src/i18n/vi.ts` | Sửa | Nhãn điều hướng tiếng Việt |
| `apps/desktop/tests/batchGrade.test.ts` | Mới | Test lọc, lựa chọn, scale, xử lý hàng loạt, lỗi, dừng |

Backend `grade_apply` của V5.2 được **tái sử dụng, không thay đổi**: cùng công thức màu, bảo toàn alpha và version lineage như chỉnh một ảnh.

## 4. Kiểm thử đã thực hiện

- Phân tích cú pháp TypeScript thành công với các file mới/thay đổi.
- Thực thi 8 nhóm kiểm tra logic độc lập bằng Node/TypeScript transpilation: filter nguồn, chọn tất cả theo filter, tìm metadata, quy đổi intensity, xử lý tuần tự, ID duy nhất, lỗi ảnh, dừng an toàn.
- Có file kiểm thử Vitest 5 trường hợp trong source; chưa chạy được bằng `npm test` vì thiếu dependencies của workspace.
- **Chưa thử nghiệm trên runtime Tauri thực tế** và chưa chạy đánh giá hiệu năng 100–1000 ảnh 4K.

## 5. Hạn chế hiện tại và bước sau

- Queue **chỉ tồn tại trong vòng đời dialog**. Các asset đã xử lý được lưu bền vững, nhưng thứ tự/chưa xử lý không được khôi phục tự động sau khi thoát ứng dụng. Muốn resume sau restart cần backend persistent batch job.
- Chưa có bộ lọc chính xác theo *phòng, tầng, góc camera, phiên bản duyệt* vì `AssetDTO` hiện không cung cấp metadata đó; cần bổ sung quan hệ tới `GenerationDTO`/Space Catalog.
- Chưa có điều chỉnh cường độ riêng từng ảnh trong cùng batch; một batch dùng cùng ColorGradeDNA.
- Chưa có chức năng xuất cả batch ra thư mục độc lập: kết quả đã nằm trong thư viện dự án và version chain.
- Cần kiểm thử đầy đủ `npm run typecheck`, `npm test`, `npm run test:rust` sau khi cài deps; kiểm tra UX desktop trước khi merge.

## 6. Chỉ dẫn tích hợp

**Dùng bản FULL_SOURCE:** Giải nén và mở thư mục `IMAGE-CREATIVE-ARCHITECT-main`; bản này đã bao gồm 30 preset V5.2 và Batch V5.3. Không upload ghi đè những thay đổi mới hơn trên GitHub mà chưa so sánh diff.

**Dùng PATCH:** Giải nén ZIP vào gốc repo có sẵn V5.2 (đúng cấu trúc `apps/desktop/...`), chỉ ghi đè các file listed và thêm hai file mới.

Chạy:

```bash
npm install
npm run typecheck
npm test
npm run lint
npm run check:rust
```

Mở app → mở một dự án đã có ảnh → Mood / Grade → Áp màu hàng loạt → chọn ảnh → chọn preset → preview → áp màu → kiểm tra asset mới.
