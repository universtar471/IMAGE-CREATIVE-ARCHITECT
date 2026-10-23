# AI Multi-Angle Camera Studio — Đặc tả kỹ thuật V1.0

**Dự án:** `universtar471/IMAGE-CREATIVE-ARCHITECT`
**Ngày:** 2026-10-23 · **Trạng thái:** sẵn sàng giao Codex phát triển; **KHÔNG ĐƯỢC PUSH/PUBLISH/MERGE** đến khi chủ dự án xem diff, test, giao diện và chấp thuận rõ ràng.

## 0. Phạm vi và quy tắc bắt buộc

Mục tiêu: từ ảnh kiến trúc gốc, điều khiển góc camera, tạo bộ ảnh nhiều góc bằng AI, lưu nguồn gốc và dùng lại trong Node, Generate, Video, Grade, Enhance, Publishing. Không tuyên bố một ảnh 2D duy nhất đủ để tái tạo 3D chính xác.

**UX R1 – Tối giản:** ưu tiên preview lớn, nút ngắn, các nhóm nâng cao đóng mặc định. Không tạo module điều hướng cấp cao mới. **UX R2 – Icon first:** icon SVG/PremiumIcon/Lucide đồng nhất, không emoji, 36–40 px hit target và aria-label. **UX R3 – Hướng dẫn trong (?)**: không đặt hướng dẫn dài dưới slider; dùng HelpPopover có sẵn. Cảnh báo lỗi vận hành phải vẫn hiển thị rõ. **UX R4 – Phân tách nội thất/công trình:** chọn theo DNA dự án, điều chỉnh preset, tọa độ, đối tượng và constraints; không lẫn công cụ của hai bối cảnh.

Giữ VI/EN qua i18n hiện hành. Hành động trả phí vẫn có nhãn `Generate` và xác nhận chi phí. Cấm gọi API khi kéo chuột/chỉnh camera. Mọi file gốc bất biến.

## 1. Repo hiện hành — đã xác minh bằng GitHub connector

- Tauri 2/Rust, React/TS, Zod domain, SQLite; đọc `CLAUDE.md`, `docs/{ARCHITECTURE,DATA_MODEL,API_CONTRACTS,UI_UX_SPEC,DECISIONS}.md` trước khi sửa.
- `CameraPanel.tsx`: danh sách, preset, Camera DNA, anchor, prompt preview; `CameraDirector.tsx`: sơ đồ camera 2D, kéo chỉnh azimuth/distance; `BatchDialog.tsx`: đã có batch AI và chi phí.
- `ProjectWorkspace.tsx`: left navigation + center view + PropertyPanel + BottomTray. `WorkspaceNav` đã có module Camera, không thêm tab bên trái.
- `BranchCanvas.tsx`: React Flow với `nodesConnectable={false}` vì graph **lịch sử asset/generation được suy diễn**, chưa phải workflow chỉnh dây tự do. Giữ nguyên graph lịch sử.
- `CameraDNASchema` trong `packages/domain/src/schemas/future.ts` đã có `azimuthDeg`, `elevationDeg`, `distanceM`, `heightM`, `lensMm`, `targetObjectId`, `viewType`, `aspectRatio` và `isAnchorView`; azimuth 0° là nhìn thẳng mặt tiền, dương là clockwise nhìn từ trên.
- `VideoRequest` phía Rust hiện chỉ nhận **một** first-frame, `max_reference_images:1`. Tạo video 2 frame là nâng cấp riêng, phải dùng capability gate.
- Không được sửa migration đã chạy; kiểm tra migration mới nhất khi thực sự tích hợp.

## 2. Phân chia thành 4 milestone

**M1 — Camera Studio MVP (bắt đầu lập trình):** bộ preset theo scope, hàm normalize/sanitize pose, preview SVG proxy không AI, các nút icon-first, help ?, đồng bộ camera đang chọn vào store hiện tại, tab Orbit trong Camera, bài test. Không có chức năng generate giả; nút Generate sau M1 hoặc dẫn vào BatchDialog hiện hữu khi đã có integration an toàn. Không yêu cầu 3D engine hoặc Python.

**M2 — Multi-view generation:** reuse BatchDialog/SpendConfirm/provider registry; 1,4,6,8 góc; Camera Rig và ViewCollection; Architecture/Material/Context lock với Prompt Compiler; cảnh báo phần kiến trúc khuất; từng ảnh có lineage/source + CameraID + prompt + model + snapshot DNA; retry từng góc; hiển thị ContactSheet và thumbnails.

**M3 — Editable Node Workflow:** thêm chế độ con History | Workflow khi ở Node mode; History vẫn là BranchCanvas không cho nối; WorkflowCanvas mới với typed handles, onConnect, DAG validator, persistence, runner, nhánh kết quả. Node Image Input → Multi-Angle Camera → AI Multi-View Generate → ViewCollection → Select View → Enhance/Grade/Video/Export. Dây không hợp lệ/cycle không được nhận. Cost confirm trước khi chạy tác vụ tính phí.

**M4 — Geometry/QC/Video:** tùy chọn depth/3D model/room geometry, scene visibility, neighbor occlusion, nội thất camera collision, QC chống sai hình khối; video start/end chỉ khi adapter API chứng minh hỗ trợ và có tests. Không ép cài Python trong M1–M3.

## 3. Giao diện trong app

### Camera Studio (Studio mode)
- Điều hướng **Camera** hiện hữu → Center: `[Plan] [Orbit ✦] [Ảnh gốc] [Views] [Prompt]`, tận dụng tab cũ. Không tạo nút cấp cao mới bên trái.
- Orbit preview giữa màn hình; 1 thanh icon trên canvas: orbit / nâng hạ / pan / target / reset / thêm camera / compare / fullscreen. Chỉ bật chức năng đã implement; icon chưa hoạt động không được dựng kiểu nút bấm.
- Inspector phải: `[Camera] [Locks] [Output]` hoặc accordion. Tab Camera có preset 4 biểu tượng theo scope, Azimuth/Elevation/Distance; Advanced có height/lens/target/aspect. Tab Locks có Architecture / Material / Context / Light. Output có số góc và provider/model/chi phí kế thừa Generate.
- `Reset`: hoàn tác về camera khi bắt đầu phiên chỉnh sửa; `Add Camera`: tạo CAM stable ID; sửa camera không làm thay đổi kết quả render cũ.
- `Zoom` giao diện phải định nghĩa rõ: dolly distance khác với focal length/FOV và crop. Góc nghiêng dùng độ thay vì `%` mơ hồ. Distance tính mét chỉ khi geometry có thang đo; nếu không hiển thị trạng thái xấp xỉ.
- Nút `?` có tooltip/focus/click/touch và Escape; không dàn text hướng dẫn ra ngoài. Lỗi/hết provider/cảnh báo dữ liệu khuất vẫn hiển thị ngắn gọn.

### Node mode
- Chỉ khi người dùng chuyển sang Node, cung cấp `[History] [Workflow]`; không thay `BranchCanvas` bằng graph tự do.
- Node `Multi-Angle`: header icon Orbit + tên ngắn + ? + menu. Mini grid 2×2 preset, count, lock/status. Tùy chọn đầy đủ trong Inspector hoặc `Open Camera Studio`.
- Cổng vào: `source_image: ImageAsset` BẮT BUỘC, `reference_images: ImageAsset[]`, `camera_rig: CameraRig`, `scene_constraints: SceneConstraints` tùy chọn. Cổng ra `views: ViewCollection`, `camera_rigs: CameraRig[]`, `preview: PreviewAsset`. Định nghĩa kiểu, hướng, multiplicity, id, required; kiểm tra link và chu trình.
- ViewCollection → module chỉ nhận một ảnh: buộc chọn một view tường minh, không lấy ngầm ảnh đầu tiên. Node giữ input fingerprint để đánh dấu stale nhưng không xóa đầu ra lịch sử.

## 4. Camera preset và logic riêng

| Công trình | Nội thất |
|---|---|
| Front facade | Wide Room |
| Left 3/4, Right 3/4 | Room Corner |
| Side, Rear* | Eye-Level |
| Street-level | Doorway |
| Aerial | Top-Down / Ceiling |
| Detail / Landscape | Furniture Detail, Reverse View* |

`*`: mặt chưa thấy hoặc hình học chưa đủ phải có cảnh báo. `exterior` dùng building-local coordinates/lot topology, `interior` dùng room-local target/pivot/boundaries. Nội thất không chọn Flycam hoặc xe ngoài trời. Nhà phố liền kề không xóa nhà bên cạnh khi tạo góc nhìn mặt bên; tận dụng visibility/site-topology có sẵn.

## 5. Preview và AI engine

**Geometry Preview (M1):** proxy từ footprint/room bounds, sơ đồ camera và frustum, cập nhật ngay khi kéo; nhãn `Geometry`, **không giả render ảnh AI**. **AI Preview (M2):** nhấn rõ ràng, xác nhận phí nếu có, không gọi theo chuyển động chuột. **Image Only:** AI suy đoán mặt khuất từ một ảnh, không bảo đảm đúng 3D. **Depth Assisted/Geometry Guided (M4):** dùng khi có depth map hoặc mesh chuẩn, không cài bắt buộc.

Prompt Compiler cần deterministic: source hash, DNA version, camera snapshot, provider/model, reference roles, lock policy. Lock phải là policy + QC, không lời hứa bất biến tuyệt đối. Nhóm trách nhiệm không lẫn: Camera pose, Lighting, Grade, Region/Edit. Nguồn nhập không bao giờ bị overwrite.

## 6. Domain & persistence contract đề nghị

`CameraRig { id, sourceAssetId, cameraIds, coordinateSystem: 'building_local'|'room_local', originMode:'dna'|'estimated'|'mesh', target }`.

`MultiAngleConfig { rigId, viewCount, preserveArchitecture:'balanced'|'strict', materialLock, contextLock, lightingLock, additionalReferences }`.

`ViewCollection { id, sourceAssetId, views:[{cameraId, assetId, generationId, status}], createdAt, DNA snapshot hash }`.

Workflow state lưu riêng với History Graph; stable IDs, SQLite migration additive, validation Zod phía domain, typed Rust application service, credential store cho API keys, no secrets trong log. Bộ xử lý job giữ được trạng thái queued/running/failed/done và an toàn khi app đóng mở lại; không submit lại job trả phí ngoài ý muốn.

## 7. Acceptance criteria (bắt buộc)

AC01 Tab Orbit chỉ có bên trong Camera, không phá navigation cũ.
AC02 Không có mô tả dài ngoài UI: icon-first, hướng dẫn qua (?) và tooltip, trạng thái quan trọng vẫn rõ.
AC03 Preset nội thất/công trình không lẫn và tự đổi theo project.
AC04 Kéo chỉnh camera preview realtime không call API.
AC05 Save/reopen sync Camera DNA với Camera Director, không sửa các ảnh render trước.
AC06 Multi-view batch tạo đủ view outputs với parent/camera ID/lineage và retry riêng từng lỗi.
AC07 Node port validation đúng kiểu/cycle/required input.
AC08 Chi phí provider/model rõ ràng; chỉ chạy khi người dùng xác nhận.
AC09 Existing History Graph và single-image Video không bị ảnh hưởng.
AC10 Với townhouse, cảnh báo occlusion, không xóa công trình bên cạnh; interior camera không xuyên tường khi có geometry.
AC11 Video 2 frame bị vô hiệu hóa nếu API/provider không hỗ trợ.
AC12 Original files immutable, project cũ/migration và VI/EN vẫn hoạt động.
AC13 Unit/DOM/Playwright/typecheck/lint/Rust tests; không chạy API trả phí trong test.
AC14 Code chờ duyệt trong local worktree hoặc branch CHƯA PUSH; cung cấp diff/test/screenshot trước khi hỏi duyệt.

## 8. Phạm vi bàn giao / Không push

Codex bắt đầu **M1**, tự đọc trạng thái repo thực tế và đặc tả. Không push, publish, merge, tạo PR từ remote branch, hay chỉnh main khi chưa có chấp thuận rõ ràng của người dùng. Cho phép tạo **local** branch `feature/multi-angle-camera-m1` và commit cục bộ nếu cần; giữ nguyên thay đổi người dùng, không `reset --hard`, `clean -fd`, force push, hoặc auto-merge. Nếu bất kỳ bước nào yêu cầu remote write, phải dừng để xin duyệt.

Sau M1 cung cấp: tổng hợp thay đổi, đường dẫn các file, diff, ảnh UI, lệnh test và kết quả, hành vi hoàn tất/chưa hoàn tất, yêu cầu xác nhận rõ ràng **trước khi push**.
