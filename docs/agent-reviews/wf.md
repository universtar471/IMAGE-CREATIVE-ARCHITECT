# Review Phase 4B — vòng 1

## WF-A — Domain

**Kết luận: ĐẠT**

Không thấy sai lệch rõ ràng với §13 trong schema, trạng thái dẫn xuất, quy tắc mở khóa, cascade `needs_review`, các trường hợp bỏ qua, hay generation gating. Domain có hỗ trợ `cameraIds` để phân biệt “không có anchor camera” với “không có camera”; UI cần truyền dữ liệu này.

## WF-B — Backend

**Kết luận: PHẢI SỬA**

- **`apps/desktop/src-tauri/src/services/workflow.rs:80-82`** — `confirm` chỉ từ chối trạng thái `confirmed`, nên chấp nhận xác nhận trực tiếp một bước `needs_review` nếu bước ngay trước đã `confirmed`. Domain helper từ chối xác nhận trạng thái này (`packages/domain/src/workflow/workflow.ts:188-190`), còn UI yêu cầu mở khóa bước để sửa trước. Ví dụ: sau khi mở khóa Bối cảnh và xác nhận lại, client có thể gọi API xác nhận Tham chiếu khi bước đó vẫn `needs_review`, bỏ qua thao tác mở khóa theo workflow hiện tại. Cần đồng nhất điều kiện xác nhận với domain/UI.

Transaction cho confirm/reopen, kiểm tra dự án archived, kiểm tra gate trước khi enqueue và backfill migration nhìn chung phù hợp hợp đồng.

## WF-C — UI

**Kết luận: PHẢI SỬA**

- **`apps/desktop/src/features/camera/CameraDirector.tsx:29, 126-138`** — Camera Director chỉ dùng `selectReadOnly` (trạng thái archived) để chặn kéo hoặc dùng phím sửa góc máy. Khi bước Góc máy bị khóa hoặc đã xác nhận, các thao tác này vẫn gọi `setCameras` vì Camera Director nằm ngoài `StepFrame` và không nhận trạng thái workflow. Có thể sửa azimuth/distance dù panel bên phải đang read-only.

- **`apps/desktop/src/features/camera/CameraPanel.tsx:49, 66-128`** — Các hành động tạo Anchor, render camera và mở Contact Sheet vẫn nằm trong panel DNA › Góc máy. Theo yêu cầu, tạo/duyệt Anchor và render phải chuyển sang Tạo ảnh. Các nút hiện cũng chỉ gate theo master/camera, không áp dụng đầy đủ gate DNA của từng purpose; backend sẽ từ chối một số thao tác mà UI vẫn cho mở.

- **`apps/desktop/src/app/store.ts:413-421,  `apps/desktop/src/app/store.ts` phần refresh workflow`** — Khi gọi `deriveWorkflow`, store chỉ truyền anchor-camera IDs và approved anchor IDs, không truyền danh sách camera. Domain helper dùng `cameraIds` để phân biệt không có camera với có camera nhưng không có anchor view (`packages/domain/src/workflow/workflow.ts:95-98`). Vì vậy dự án có camera thường nhưng không có anchor view sẽ hiện Render là `skipped`, dù hợp đồng yêu cầu Anchor `skipped` và Render `available`. Cần truyền camera IDs ở cả lúc mở dự án lẫn refresh workflow.

- **`apps/desktop/src/features/workflow/StepFrame.tsx:28-33, 41-46`** — Hộp thoại mở khóa lấy danh sách bước sau có trạng thái `needs_review`. Trước khi mở khóa, các bước phía sau đang `confirmed`; chính thao tác backend mới chuyển chúng thành `needs_review`. Do đó khi cascade sắp xảy ra, hộp thoại không liệt kê các bước sẽ bị ảnh hưởng.

- **`apps/desktop/src/features/overview/OverviewPanel.tsx:158-193, 202-225`** — Hub chưa có quick-edit fields cho các bước. Mở rộng hàng chỉ hiển thị nút Mở/Xác nhận/Mở khóa; phần tóm tắt còn trả nội dung chung “Review the saved values” cho hầu hết bước. Điều này chưa đáp ứng yêu cầu quick edit các trường chính, chỉ cho sửa khi bước available.

- **`apps/desktop/src/i18n/vi.ts:341-367`** — Nhiều chuỗi workflow tiếng Việt bị mojibake, ví dụ `BÆ°á»›c`, `CÃ¡ch dÃ¹ng`, `XÃ¡c nháº­n`. Người dùng chọn tiếng Việt sẽ thấy chữ lỗi dù các key đã tồn tại.

- **`apps/desktop/src/features/workspace/modules.ts:44-86` và `apps/desktop/src/components/shell/WorkspaceNav.tsx:21-22`** — Overview và năm mục DNA cùng thuộc group `project`; nav chỉ chèn vạch ngăn khi group đổi. Vì vậy DNA không được thể hiện thành nhóm riêng như yêu cầu. Ngoài ra, trạng thái `skipped` đang rơi vào icon mặc định hình tròn thay vì dấu gạch ngang (`WorkspaceNav.tsx:66-71`).