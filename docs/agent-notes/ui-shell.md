# Bàn giao `wt/ui-shell`

## Mục tiêu

ADR-040 UI-1 + UI-2: điều hướng trái năm mục (Tạo ảnh tự động, Ảnh của tôi, Chỉnh sửa ảnh,
Trình bày & xuất, Studio nâng cao), dải tab cho `edit`/`present`, màn "Ảnh của tôi", và một
điểm gắn duy nhất `CreateSectionView` cho mục Tạo ảnh.

## Đã làm

- `features/workspace/modules.ts`: `SectionId`, `WORKSPACE_SECTIONS` (thứ tự module theo
  ADR-040), `TABBED_SECTIONS`, `sectionOfModule`, `defaultSectionModules`. `ModuleId` và
  `WORKSPACE_MODULES` giữ nguyên.
- `app/store.ts`: thêm `activeSection`, `sectionModules` (module cuối của mỗi mục, chỉ ở UI
  state, không vào DNA), `trayCollapsedOutsideLibrary`, action `setSection`, selector
  `selectSection`. `setModule(id)` chọn luôn mục sở hữu module đó và ghi nhớ module. Mục đang
  hiện được suy ra từ `activeModule` (trừ `library`), nên code/test gọi thẳng
  `setState({ activeModule })` vẫn đúng. `openProject` reset các trường này.
- Khay dưới: vào `library` thì khay thu gọn; rời `library` thì trả lại trạng thái cũ.
- `components/shell/WorkspaceNav.tsx`: năm nút mục (`data-section`), Studio tách xuống dưới
  (`.nav-studio`, `margin-top: auto`); khi Studio mở thì có danh sách phụ chín module
  (`role="group"`), giữ số bước, icon trạng thái workflow, nhãn "Không gian" cho
  `design_dna` khi là dự án nội thất.
- `features/workspace/ProjectWorkspace.tsx`: `SectionTabs` (exported) phía trên vùng giữa
  cho `edit`/`present`; `CreateSectionView` (exported) hiện render vùng giữa + Generate panel
  hiện có; mục `library` render `LibraryView` + `LibraryPanel`.
- `features/library/`:
  - `library.ts`: bộ lọc thuần (tên không phân biệt dấu/hoa thường, loại AI tạo/đã nhập theo
    `asset.source`, trạng thái), store chọn nhiều `useLibrary` (gắn theo projectId),
    `actionTargets`, các thao tác `openInEdit`, `applyAsSource`, `downloadAssets`.
  - `LibraryView.tsx`: lưới, ô lọc tên, chọn loại/trạng thái, checkbox chọn nhiều, "Chọn các
    ảnh đang hiện", "Bỏ chọn".
  - `LibraryPanel.tsx`: thao tác + `AssetPropertyPanel`, `VersionsTab`, `HistoryTab` dùng
    lại nguyên vẹn.
- Thao tác: áp dụng cho các ảnh đã tick, nếu không tick thì cho ảnh đang chọn; ảnh mất file bị
  bỏ qua.
  - Mở trong Chỉnh sửa ảnh: `selectAsset` + `setSection("edit")`.
  - Dùng làm ảnh nguồn: `setGenerateDraft({ referenceAssetIds, source })` (một structure
    sketch thì `source: "sketch"`), rồi `setSection("create")`.
  - Tải xuống: bridge có sẵn `publication_export_save` định dạng PNG, bytes lấy từ
    `asset_preview` (backend trả PNG) với `maxEdge` 4096.
- i18n: khối `sections` và `library` trong `en.ts`/`vi.ts` (chèn ngay sau `modules`).
- CSS: khối "ADR-040" ở cuối `styles/app.css`.
- Test: `apps/desktop/tests/uiShell.test.tsx` (15 test). Đã sửa một test trong
  `workflowRound1.test.tsx` vì nav không còn header "Post-production": giờ test kiểm tra mục
  "Edit images".

## Còn nợ

- **Thêm vào hồ sơ trình bày: KHÔNG làm.** Không có hook sẵn: `usePublishing` chỉ có
  `replaceImage` cho một slot đã có và `plan` theo settings; không có hàm "thêm một asset vào
  publication". Cần một API trong `features/publishing/store.ts` trước.
- Tải xuống không phải file gốc: tối đa 4096 px cạnh dài, luôn là PNG (giới hạn của
  `asset_preview`). Backend hỏi chọn thư mục và đặt tên kiểu export publication:
  `<tên ảnh>-p01.png`, nhiều ảnh thì `images-p01.png`, `images-p02.png`… Muốn tải file gốc thì cần một lệnh Rust mới (ngoài phạm vi).
- `CreateSectionView` đang chiếm cả vùng giữa lẫn panel phải; lead sẽ đổi chỗ gắn sang màn
  quick-generate.
- Workspace vẫn mở ở Studio/Tổng quan như trước (không đổi trang đích mặc định).
- Danh sách Lịch sử trong panel là toàn bộ lịch sử dự án (dùng lại component), không lọc
  theo ảnh.

## Lệnh test

- `npx vitest run apps/desktop/tests/uiShell.test.tsx apps/desktop/tests/workflowRound1.test.tsx`
- `npm run verify`
- `npx prettier --check .`

## Cạm bẫy

- Không đặt tên hàm thường bắt đầu bằng `use…` (ví dụ `useAsSource`) vì eslint react-hooks coi
  là hook, nên đặt là `applyAsSource`.
- jsdom không fetch được URL `blob:` của fixture: test bọc mock transport, trả bytes cho
  `asset_preview`.
- `createProject` cho dự án nội thất cần `subtype: "default", starter: {}`.
- i18n `en.ts`/`vi.ts` cũng bị các nhánh ui-wizard/ui-generate/ui-source-assist sửa; khi
  merge có thể xung đột ngay sau khối `modules`.

Chưa commit theo yêu cầu.
