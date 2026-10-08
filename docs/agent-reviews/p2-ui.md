# Review P2-C (wt/p2-ui)

## Kết luận: PHẢI SỬA

Có lỗi lệch contract §9 và các race condition có thể làm mất references hoặc hiển thị assets sai project. Dù đã merge, cần sửa các điểm chặn dưới đây.

## PHẢI SỬA (chặn merge)

1. **Validator và mock chấp nhận giá trị mà backend thật từ chối.**  
   `packages/domain/src/generation/helpers.ts:206`, `:214`; `packages/domain/tests/generation.test.ts:185`. Điều kiện `model.aspectRatios.length` / `model.imageSizes.length` bỏ qua kiểm tra khi danh sách rỗng. Ví dụ `gemini-2.5-flash-image` với `imageSize: "8K"` được helper và mock chấp nhận, trong khi §9 và Rust yêu cầu `null`. Test hiện còn cố định hành vi sai này.  
   **Sửa:** mọi giá trị khác `null` phải nằm trong danh sách; thay test bằng các trường hợp danh sách rỗng từ chối chuỗi và chấp nhận `null`, kiểm tra cả mock qua bridge.

2. **Submit đọc references từ workspace có thể đã đổi sau `await`.**  
   `apps/desktop/src/app/store.ts:368`, `:374`. Khi Generate ở A đang chờ `flushDna`, người dùng rời A/mở B; đoạn tiếp theo lấy assets của B hoặc `[]`. `orderReferenceIds` âm thầm bỏ IDs của A, nhưng request vẫn gửi cho A. Kết quả có thể là Hero không có master/reference và lineage sai.  
   **Sửa:** gắn toàn bộ bước chuẩn bị request với `projectId`; lấy persisted bundle của A rồi dùng cùng snapshot để sắp references và compile prompt. Không âm thầm loại reference không tìm thấy. Thêm test giữ `dna_update` pending rồi chuyển project trước khi resolve.

3. **“Use as master” có thể ghi assets của A vào workspace B.**  
   `apps/desktop/src/features/generate/GenerationResult.tsx:81`, liên quan `apps/desktop/src/app/store.ts:293`. Bấm “Use as master” ở A rồi mở B trước khi `asset_set_master` trả về: `adoptAssets(list)` lấy workspace hiện tại và gắn danh sách assets của A vào B. Canvas/tray của B hiển thị ảnh sai project.  
   **Sửa:** truyền `projectId` vào `adoptAssets` và kiểm tra ownership trước khi cập nhật, kể cả danh sách rỗng. Thêm test trì hoãn response `asset_set_master`, chuyển sang B và xác nhận B không đổi.

4. **Kết quả có thể bị bỏ sót khi project đang mở lại.**  
   `apps/desktop/src/app/store.ts:178`, `:381`. A đang generate; người dùng rời rồi mở lại A. `project_get`/`generation_list` có thể đã đọc snapshot chưa có output, nhưng chưa trả xong. Generation hoàn tất lúc `workspace === null`, nên bỏ qua refresh. Sau đó `openProject` nhận snapshot cũ: History vẫn `running`, assets thiếu output dù `run` đã `done`.  
   **Sửa:** đồng bộ việc mở project với revision/token của generation; nếu generation hoàn tất trong lúc load, tải lại dữ liệu trước khi nhận snapshot. Thêm test điều khiển thứ tự resolve cho đúng tình huống này.

## NÊN SỬA

1. **Result card giữ snapshot đã lỗi thời sau khi xóa output.**  
   `apps/desktop/src/features/generate/GenerationResult.tsx:48`, `:69`. `fromRun` luôn được ưu tiên hơn history mới. Generate xong, xóa output trong References rồi quay lại Generate: card vẫn giữ ID cũ và bật “Use as master”; bấm sẽ gặp `NOT_FOUND`.  
   **Sửa:** hòa giải `run.generation` với dữ liệu hiện tại hoặc lọc outputs theo assets; vô hiệu hóa action khi `currentAsset` không tồn tại. Test luồng generate → xóa output → quay lại.

2. **Provider response cũ có thể ghi đè trạng thái vừa Save/Clear.**  
   `apps/desktop/src/app/store.ts:312`. Mở settings kích hoạt `provider_list`; trong lúc response này pending, Save key hoàn tất và `adoptProvider` cập nhật `configured: true`. Response list cũ về sau có thể ghi lại `false`, khiến Generate bị khóa sai.  
   **Sửa:** dùng request/mutation revision để bỏ response cũ; test resolve list sau Save và sau Clear.

3. **Mock không phản ánh việc archive giữa generation.**  
   `apps/desktop/src/lib/mockBackend.ts:602`, `:613`. Submit rồi archive trong khoảng delay vẫn tạo outputs và trả `completed`. Rust kiểm tra lại khi commit và trả generation `failed`, error kind `interrupted`, không lưu outputs.  
   **Sửa:** kiểm tra archive sau delay trước khi tạo outputs và thêm test đối chiếu hành vi này.

4. **Dialog chưa quản lý focus của modal.**  
   `apps/desktop/src/components/common/Dialog.tsx:19`, `:39`. Có `aria-modal` và Escape nhưng không giữ focus trong dialog, không khôi phục focus khi đóng. Khi mọi provider đã configured, mở settings không có input `autoFocus`; bàn phím có thể tiếp tục thao tác workspace phía sau. Nested confirm cũng không giữ Tab bên trong. Đây là hạn chế của component dùng chung được P2-C tái sử dụng.  
   **Sửa:** thiết lập focus ban đầu, trap Tab/Shift+Tab trong modal trên cùng và restore focus; bổ sung test bàn phím ngoài test Escape.

5. **Test hygiene chưa kiểm tra input thật của dialog.**  
   `apps/desktop/tests/mockGeneration.test.ts:112`. Test gọi bridge trực tiếp chỉ chứng minh mock không lưu key; không chứng minh password input được xóa khi Save thành công/thất bại hoặc đóng rồi mở lại.  
   **Sửa:** render `ProviderSettingsDialog`, nhập secret, submit qua transport kiểm soát được và assert input/store/localStorage; không chỉ kiểm tra DTO.

## ĐẠT / điểm tốt

- `ProviderSettingsDialog.tsx:65` đọc key từ uncontrolled input và xóa ngay trước `await`; không thấy đường ghi key vào zustand, React state, localStorage hoặc console. Mock chỉ giữ boolean.
- Bridge parse response của đủ bảy command bằng Zod; DTO Rust và fixtures tương thích về các trường đã đối chiếu, gồm `generationId` nullable và error kind mở.
- Thứ tự role rồi asset ID khớp compiler và Rust giữ thứ tự request. Tuy nhiên cần sửa snapshot race nêu trên.
- Chặn submit thứ hai được đặt đồng bộ trước `await`; generation không phụ thuộc vòng đời Generate panel.
- Hooks ở các component mới không bị gọi có điều kiện; elapsed timer có cleanup, request effects có cờ bỏ response sau unmount.
- Tái sử dụng `SectionPanel`, fields, badges và canvas phù hợp style frontend hiện có. CSS có panel/tray scroll, giới hạn chiều cao dialog và footer Generate sticky; chưa xác nhận trực quan tại 1366×768.

## Đã chạy

- `npm.cmd run typecheck`: **PASS**.
- `npm.cmd run lint`: **PASS**.
- `npx.cmd vitest run`: **bị chặn trước khi chạy test**, lỗi `EPERM` khi Vite ghi cấu hình tạm vào `node_modules/.vite-temp`.
- Các lệnh `npm`/`npx` ban đầu bị PowerShell Execution Policy chặn; dùng `.cmd` mà không đổi policy.
- Đã đọc tài liệu yêu cầu, diff UI và đối chiếu backend thật. Các race trên được xác định bằng đọc code, chưa có test tái hiện chạy thành công trong phiên này.
- Giữ branch `main`; không sửa, tạo hay commit file. `git status --short` cuối phiên không báo thay đổi.