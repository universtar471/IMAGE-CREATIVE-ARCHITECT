# Báo cáo AI Multi-Angle Camera Studio M1

Ngày: 23/10/2026. Trạng thái: triển khai local, chờ chủ dự án duyệt.

## Git và phạm vi

- Repository: `universtar471/IMAGE-CREATIVE-ARCHITECT`.
- Base: `aa2efa7c942c40a6f7db70fc74b70adc76bd6bcd` — Merge prompt fidelity, camera framing and Space context fixes.
- Worktree: `/workspace/scratch/797f52af00a3/multi-angle-m1`.
- Branch: `feature/multi-angle-camera-m1`.
- Chưa commit/push/merge, chưa tạo PR, chưa chỉnh repository remote.
- Đọc đặc tả và nhiệm vụ trong ZIP, CLAUDE.md, kiến trúc, mô hình dữ liệu, API, UX và triển khai Camera hiện hành; tích hợp starter vào checkout thật.

## Thay đổi mã nguồn

| File | Thay đổi |
|---|---|
| `apps/desktop/src/features/camera/multiAngleModel.ts` | Preset rời nhau cho công trình/nội thất, scope theo domain DNA, chuẩn hóa/clamp góc và khoảng cách, tọa độ proxy; không I/O. |
| `apps/desktop/src/features/camera/OrbitViewport.tsx` | SVG proxy công trình/phòng và vùng nhìn minh họa; kéo xoay/nghiêng, pointer capture, cancel/lost capture và tách pointer; không gọi AI. |
| `apps/desktop/src/features/camera/MultiAngleStudio.tsx` | Preset icon, ba slider, Reset/Add, HelpPopover, đọc/ghi camera đang chọn và quyền chỉ đọc qua store hiện hữu. |
| `apps/desktop/src/features/camera/multi-angle.css` | Preview lớn, điều khiển gọn theo hai cột, nút có vùng chạm ít nhất 36px, responsive và cuộn trong vùng trung tâm. |
| `apps/desktop/src/features/workspace/ProjectWorkspace.tsx` | Tab Orbit bên cạnh Camera Director, chỉ ở Camera; Node mode vẫn dùng BranchCanvas. |
| `apps/desktop/src/app/store.ts` | Mở rộng CenterView với `orbit`; rời Camera trả về canvas; cơ chế lưu DNA giữ nguyên. |
| `apps/desktop/src/i18n/en.ts`, `vi.ts` | Chuỗi giao diện và hướng dẫn qua hệ thống i18n chuẩn. |
| `apps/desktop/tests/multiAngleModel.test.ts`, `multiAngleStudio.test.tsx` | Kiểm tra scope/preset, dữ liệu không hợp lệ, đồng bộ, reset, ID, quyền chỉ đọc, lưu/mở lại và không có lệnh trả phí. |
| `tools/qa/multi-angle-m1-browser.mjs` | Chromium acceptance với mock transport, ảnh màn hình, kiểm tra tương tác thật và không gọi provider. |
| `docs/MULTI_ANGLE_CAMERA_SPEC_V1.md`, `tasks/MULTI_ANGLE_M1.md`, `docs/PROGRESS.md` | Đặc tả nguồn, trạng thái M1 và danh sách việc M2–M4 local. |

## Kết quả cuối

| Kiểm tra | Kết quả |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build -w @arch/desktop` | PASS; cảnh báo chunk lớn |
| `npx vitest run --maxWorkers=2` | 113 file, 1.211 test PASS |
| M1 sau thay đổi cuối | 2 file, 10 test PASS |
| Chromium acceptance | PASS; 1440×900, mouse/touch/keyboard, 0 paid commands, 0 page errors |
| Rust/native | Chưa chạy được: thiếu Cargo |

## Hành vi và bốn quy tắc UX

1. Không thêm điều hướng cấp cao. Camera Director, ảnh gốc, Contact Sheet và Prompt Preview giữ nguyên.
2. Preset, Add, Reset dùng SVG icon có tên truy cập/tooltip. Slider dùng đơn vị độ và mét, có bàn phím; không dựng nút Generate giả.
3. Hướng dẫn thao tác, ý nghĩa preset và khoảng cách nằm trong nút (?). Escape đóng trợ giúp. Proxy ghi rõ “Hình học · Ước tính”.
4. Scope lấy từ `isInteriorShot` thông qua domain: active space quyết định khi dự án có nhiều loại cảnh, không chỉ xét projectType. Nội thất không có Flycam. Các thuộc tính không liên quan của camera được giữ lại.

Camera là nguồn dữ liệu duy nhất. Mỗi thay đổi cập nhật draft DNA; autosave có debounce hiện hữu xử lý lưu. Kéo không chạy generation, batch hoặc vision. Reset về pose khi vào phiên Orbit của camera đang chọn; đổi camera/scope hoặc đóng/mở Orbit bắt đầu phiên reset mới. Thêm camera dùng `blankCamera` tạo CAM ULID. Thông số nâng cao vẫn nằm trong Camera Panel sẵn có.

## Kiểm chứng

Kết quả cụ thể và log được kèm trong thư mục `logs/`; kết quả browser ở `browser-results.json`.

- Typecheck toàn workspace; ESLint toàn repo; frontend production build.
- Unit/DOM toàn domain và desktop. Một lần chạy song song mặc định gặp timeout ở test có sẵn `branchCanvas > compares two images selected with Shift in the large viewer`; lần đầu toàn suite từng qua, và chạy lại riêng 6 test BranchCanvas qua. Chạy hồi quy cuối giới hạn hai worker để giảm tranh chấp tài nguyên; không sửa test/implementation History Graph.
- Browser Chromium 153, viewport 1440×900: tab Camera, preset, kéo chuột, cảm ứng qua CDP touch, bàn phím, cancel, Help/Escape, lưu/mở lại mock, scope VI/EN và không có lệnh trả phí. Ảnh là ảnh chạy ứng dụng thật với backend giả lập; không phải thiết kế minh họa.
- `npm run check:rust` bị chặn vì `cargo: not found`. Không sửa Rust/SQLite/migration. Chưa xác nhận native Tauri/Windows.

## Giới hạn còn tồn tại

- Proxy hình học ước tính từ footprint hoặc chiều rộng/sâu phòng đã xác nhận, fallback nếu thiếu. Không tái dựng ngôi nhà từ ảnh, không render AI, không mô phỏng chính xác lens/frustum, mặt khuất, vật liệu, target tùy ý hoặc va chạm tường.
- Khoảng cách và góc là dữ liệu Camera DNA; ảnh proxy chỉ minh họa. Nhập cảnh thật cần geometry/scale được kiểm chứng ở M4. Các preset M1 thay đổi pose; viewType, lens, composition và Visual Intent vẫn được quản lý ở Camera Panel hiện hữu, không tự ghi đè chúng.
- Orbit hỗ trợ azimuth chuẩn hóa [-180,180), elevation [-75,75] và distance [0.5,1000] m. Dữ liệu cũ ngoài phạm vi không bị sửa khi chỉ mở Orbit, nhưng thao tác chỉnh áp dụng clamp của Orbit.
- Lưu/mở lại đã kiểm chứng qua mock transport. Chưa có bằng chứng chạy native SQLite, khởi động lại Tauri hoặc thao tác trên Windows/touchscreen vật lý.
- M2 (sinh nhiều ảnh), M3 (workflow nối dây), M4 (geometry/QC/video) chưa triển khai. Không thay History Graph hay single-image Video.
- Build còn cảnh báo chunk JS lớn hơn 500 kB; không mở rộng việc này thành refactor bundle.
- Panel Camera bên phải là UI sẵn có, vẫn có mô tả Visual Intent; quy tắc hướng dẫn qua (?) áp dụng cho điều khiển Orbit mới.

Chỉ được push sau khi người dùng xem diff/test/ảnh và xác nhận rõ ràng.
