# wt/variation-panel

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-24 03:09

## Mục tiêu và phê duyệt

Người dùng báo không chọn được góc máy, yêu cầu một khung phải chỉ dành cho tạo biến thể, đã duyệt kế hoạch trước khi triển khai. Tiếp tục quy trình test rồi gộp main đã được yêu cầu trong chat; không push GitHub.

Base `24fa044`; worktree Codex riêng `D:/worktrees/IMAGE-CREATIVE-ARCHITECT-github/variation-panel`.

## Đã thực hiện

- Góc máy có hai nút rõ ràng Giữ góc gốc / Đổi góc máy. Mở khóa dùng transition hiện có, kể cả mức thay đổi 0 và chưa có camera; store tạo Camera DNA hợp lệ. Không tự bỏ khóa chỉ vì người dùng chỉnh một pose trong Studio.
- Nút mở khóa trong Camera Studio không còn phụ thuộc việc đã chọn sẵn camera. Link camera không tồn tại không được tái dùng để mở khóa.
- Camera Studio chuyển sang Studio/Orbit thật từ Node; vẫn giữ khung Tạo biến thể bên phải khi đang làm biến thể.
- `startVariation(assetId)` là entry point chung cho toolbar ảnh nhập/AI và nút từ kết quả. Gắn ảnh nguồn, chọn goal variations khi cần và mở inspector, không gọi provider. Cùng nguồn/cùng draft giữ các lựa chọn; nguồn mới giữ thiết lập thiết kế nhưng khóa lại góc theo cơ chế cũ.
- `generatePanelMode` là UI state phiên làm việc, reset khi mở dự án. Không thêm schema hoặc migration.
- Khung phải Biến thể: thumbnail/tên nguồn, quay lại Tạo ảnh, thiết lập model/chất lượng/số lượng thu gọn, góc máy, Style/tham chiếu, ánh sáng, mức thay đổi/giữ nguyên, instruction và nút tạo sticky/chi phí. Không hiện Goal/Room/Space/DNA/workflow/selection inspector.
- Trở về Tạo ảnh giữ state; menu Tạo ảnh cũng đưa về view tạo ảnh. Reuse history chọn đúng view theo purpose.
- Kết quả trong khung biến thể chỉ lấy variation đúng nguồn; không hiện nút chọn Master, xác nhận DNA hoặc những shortcut hậu kỳ khác. Hàng đợi, kết quả, phiên bản và lineage vẫn qua cơ chế hiện có.
- Nguồn bị xóa/mất chặn nút tạo, không dùng nhầm ảnh khác. Request Nội thất vẫn dùng structured compiler, top-level cameraId null; camera pose nằm trong snapshot Nội thất.
- VI/EN và SVG icons dùng thư viện hiện có.

## File chính

- `features/camera/InteriorCameraControls.tsx`, `CameraSyncStatus.tsx`: khóa/mở góc và mở Studio.
- `app/store.ts`: mode UI, startVariation, reuse state.
- `components/panels/PropertyPanel.tsx`, `components/shell/WorkspaceNav.tsx`: inspector theo ngữ cảnh và quay lại tạo ảnh.
- `features/generate/GeneratePanel.tsx`, `VariationSource.tsx`, `GenerationResult.tsx`, `interior/InteriorGenerateFlow.tsx`, `InteriorResultActions.tsx`: hiển thị biến thể và tái sử dụng pipeline.
- `features/selection/actions.ts`, `useSelectionActions.tsx`: hai loại ảnh dùng entry point chung.
- `i18n/en.ts`, `vi.ts`; `tests/variationPanel.test.tsx`; một sửa type fixture trong `tests/interiorWorkflow.test.tsx`; `tools/qa/variation-panel.mjs`.

## Kiểm chứng

- Test trước sửa: chưa có thao tác mở camera rõ ràng và chưa có entry point/panel biến thể; ba case ban đầu đỏ. Sau triển khai, bốn case regression mới đạt, gồm nguồn bị xóa.
- Targeted regression cuối: 30 test qua 3 file (variationPanel, cameraSync, interiorWorkflow) đạt.
- Browser `variation-panel.mjs`: toolbar ảnh nhập → Biến thể, mở camera khi chưa có pose, chọn góc vào prompt, source thứ nhất, cameraId null, quay lại không mất lựa chọn, Studio giữ inspector, kết quả AI tiếp tục thành nguồn mới; không có cuộc gọi khi chỉ đổi UI. Nút tạo sticky ở 1280×720, 1440×1000, 1920×1080. Không lỗi JavaScript. Đã xem ảnh chụp panel Node và Camera Studio.
- Ba browser regression cũ đều đạt: interior-generation, reference-assist và test:ui (Công trình/Node/video/vùng chọn/màu/xuất/tải ảnh).
- Typecheck/frontend production build/lint đạt. Toàn bộ frontend/domain: 121 file, 1.266 test đạt (398,23 giây, threads/1 worker). Prettier các file thay đổi và git diff --check đạt.

## Lệnh và giới hạn

```powershell
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm run build -w @arch/desktop
npm test -- --pool=threads --maxWorkers=1 --reporter=dot
node tools/qa/variation-panel.mjs
node tools/qa/interior-generation.mjs
node tools/qa/reference-assist.mjs
npm run test:ui
git diff --check
```

- Windows test worker fork khởi động timeout một lần; dùng threads/1 worker để hoàn tất kiểm chứng, không nới timeout assertion.
- Browser dùng mock và provider local_preview; không gọi AI trả phí hoặc viết dữ liệu dự án thật. Chưa kiểm tra native Tauri/WebView2 hay tạo lại bộ cài.
- Cảnh báo bundle >500 kB và các cảnh báo media của JSDOM đã có sẵn. Không sửa backend/provider/database.
