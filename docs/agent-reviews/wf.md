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
---

# Review Phase 4B — vòng 2

## Kết luận: PHẢI SỬA

### Đối chiếu các mục vòng 1

| Mục vòng 1 | Kết quả |
|---|---|
| Backend từ chối xác nhận trực tiếp bước `needs_review` | **ĐÃ SỬA** — [workflow.rs](/D:/worktrees/IMAGE-CREATIVE-ARCHITECT/wf-integrate/apps/desktop/src-tauri/src/services/workflow.rs:89) chỉ cho xác nhận khi trạng thái là `open`. |
| Camera Director phải read-only khi bước Góc máy chưa mở hoặc đã xác nhận | **ĐÃ SỬA** — [CameraDirector.tsx](/D:/worktrees/IMAGE-CREATIVE-ARCHITECT/wf-integrate/apps/desktop/src/features/camera/CameraDirector.tsx:30) áp dụng trạng thái workflow cho kéo và phím chỉnh góc. |
| Anchor, render và Contact Sheet phải thuộc Tạo ảnh | **ĐÃ SỬA** — các hành động được chuyển vào [GeneratePanel.tsx](/D:/worktrees/IMAGE-CREATIVE-ARCHITECT/wf-integrate/apps/desktop/src/features/generate/GeneratePanel.tsx:216); CameraPanel không còn chứa chúng. |
| Truyền `cameraIds` để phân biệt không có camera với không có anchor camera | **ĐÃ SỬA** — store truyền danh sách camera khi mở và làm mới workflow; domain dùng danh sách này để suy ra trạng thái Render. |
| Hộp thoại mở khóa liệt kê các bước sẽ bị cascade sang `needs_review` | **ĐÃ SỬA** — [StepFrame.tsx](/D:/worktrees/IMAGE-CREATIVE-ARCHITECT/wf-integrate/apps/desktop/src/features/workflow/StepFrame.tsx:25) tính các bước đang `confirmed` trước khi gọi backend. |
| Overview có tóm tắt và quick edit cho các bước DNA | **ĐÃ SỬA** — [OverviewPanel.tsx](/D:/worktrees/IMAGE-CREATIVE-ARCHITECT/wf-integrate/apps/desktop/src/features/overview/OverviewPanel.tsx:147) hiển thị tóm tắt và trường sửa, chỉ bật khi bước ở trạng thái `available`. |
| Chuỗi workflow tiếng Việt không bị mojibake | **ĐÃ SỬA** — các chuỗi ở `vi.ts` đọc được bằng UTF-8; diff cũng thêm kiểm tra từ điển. |
| Nav chia nhóm và trạng thái `skipped` có biểu tượng gạch ngang | **ĐÃ SỬA** — nhóm được tách trong `modules.ts`, nav hiển thị nhãn DNA/Hậu kỳ và dấu gạch ngang cho `skipped`. |

### Lỗi mới — PHẢI SỬA

- **[packages/domain/src/workflow/workflow.ts](/D:/worktrees/IMAGE-CREATIVE-ARCHITECT/wf-integrate/packages/domain/src/workflow/workflow.ts:82)** — `generate.master` được đặt `done` chỉ dựa vào `facts.masterApproved`, kể cả khi một bước DNA đã bị mở lại. Ví dụ: dự án có Master đã duyệt, mở lại Bối cảnh rồi xác nhận lại; các bước DNA phía sau vẫn `needs_review`, nhưng Master vẫn hiện `done`. Điều này trái tiêu chí “Tạo ảnh (Master) khóa đến khi các bước được xác nhận lại”. Do `anchorsStatus` và `renderStatus` cũng dựa vào trạng thái duyệt Master thay vì việc DNA đã hoàn tất, stepper có thể tiếp tục hiển thị các bước tạo ảnh sau là mở hoặc xong trong lúc chuỗi DNA chưa được xác nhận lại. Cần để trạng thái Master bị khóa khi DNA chưa hoàn tất, rồi suy ra trạng thái các bước sau từ điều kiện đó.

### Rà soát các tiêu chí chấp nhận

- Chuỗi dự án mới: domain và UI có các bước DNA lần lượt; bước tạo Master mở khi DNA đã xác nhận.
- Sau khi duyệt Master: Anchor được bỏ qua khi không có anchor camera; Hậu kỳ mở theo trạng thái Master.
- Mở lại Bối cảnh: backend cascade các bước DNA sau sang `needs_review`, không xóa ảnh. **Còn lỗi trạng thái `generate.master` nêu trên.**
- Backend: `generation_submit` và `batch_create` đều kiểm tra gate trước khi đưa job vào hàng đợi; batch kiểm tra lại trong transaction.
- Migration: tạo `workflow_steps`, backfill đủ năm bước cho dự án có `master_approved_at`.
- Overview hub: có trạng thái, tóm tắt, mở bước, xác nhận/mở khóa và quick edit.
- “Ghim” dùng cho pin prompt; nút xác nhận dùng “Xác nhận & khóa bước”; chuỗi workflow có cả vi/en.
- Nav có nhóm Overview, DNA, Tạo ảnh, Hậu kỳ và Export.

Không chạy test theo yêu cầu. Tôi không tìm thấy ADR-022 trong các file được track trên `main`; phần đối chiếu ADR dựa trên mô tả trong `PHASE_04B.md` và hợp đồng API §13.

## Lead check (Claude, 80d7fdb)

- `npm run verify` xanh: 364 Vitest, 235 Rust; fmt, clippy, prettier sạch.
- Thử trên bản mock (port 1422): nav nhóm đúng, StepFrame + Cách dùng + Ghim hiện đúng, xác nhận bước 1 mở bước 2, bước 4 khoá có banner "Hoàn thành Tham chiếu trước" và các ô nằm trong fieldset disabled.
- NÊN SỬA (lead): mục nav bước 1 và tiêu đề panel vẫn ghi "DNA thiết kế" (trùng tên nhóm) — phải là "Kiến trúc" / "Architecture"; panel bên phải giữ vị trí cuộn cũ khi đổi bước — cuộn về đầu.
- Ghi chú: ADR-022 có trên main (docs/DECISIONS.md:231); nhận xét "không tìm thấy" của reviewer là nhầm.

---

# Review Phase 4B — vòng 3

## Kết luận: ĐẠT

- **Gate DNA → Tạo ảnh nhất quán:** [workflow.ts:82](/D:/worktrees/IMAGE-CREATIVE-ARCHITECT/wf-integrate/packages/domain/src/workflow/workflow.ts:82) khóa Master, Anchor và Render khi DNA chưa hoàn tất; [workflow.ts:234](/D:/worktrees/IMAGE-CREATIVE-ARCHITECT/wf-integrate/packages/domain/src/workflow/workflow.ts:234) vẫn cho phép variation nếu Master đã duyệt. Rust áp dụng cùng quy tắc ở [workflow.rs:124](/D:/worktrees/IMAGE-CREATIVE-ARCHITECT/wf-integrate/apps/desktop/src-tauri/src/services/workflow.rs:124); mock dùng gate domain ở `mockBackend.ts:512`; UI gate nút tạo ảnh và Anchor/Render ở [GeneratePanel.tsx:84](/D:/worktrees/IMAGE-CREATIVE-ARCHITECT/wf-integrate/apps/desktop/src/features/generate/GeneratePanel.tsx:84) và `GeneratePanel.tsx:230`.

- **Tên bước và nhóm:** nhãn bước đầu là “Architecture” / “Kiến trúc”, còn “Design DNA” / “DNA thiết kế” được giữ làm tiêu đề nhóm. Cả nav và panel lấy nhãn từ cùng khóa i18n.

- **Cuộn panel:** `PropertyPanel.tsx:25–27` đặt `scrollTop` về 0 khi module đổi.

- **Có kiểm thử hồi quy** cho domain, Rust, mock và UI; các kiểm thử bao gồm variation và khôi phục trạng thái sau khi xác nhận lại DNA. Theo yêu cầu, tôi không chạy test.

## Lead verify (Claude, 059757d)

- `npm run verify` xanh: 369 Vitest, 236 Rust; fmt, clippy, prettier sạch.
