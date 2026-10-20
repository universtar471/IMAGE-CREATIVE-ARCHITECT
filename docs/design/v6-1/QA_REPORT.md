# UX/UI V6.1-R1: Báo cáo QA

Nhánh: `claude/ux-v6-1`. Gốc là `main` 7fa825c, đã gộp thêm nhánh PR #2 (`feature/premium-duotone-preset-ui-20261020`). Kiến trúc được mô tả trong ADR-044.

## Môi trường kiểm tra

- Toàn bộ ảnh chụp và số đo dưới đây lấy từ Vite dev server, giao diện chạy với backend mock, trình duyệt Chromium headless (Playwright). Không có lời gọi provider AI thật nào.
- Ảnh "before" chụp từ một worktree riêng của `main` 7fa825c (chưa có PR #2), dùng cùng script và cùng kích thước cửa sổ.
- Windows Display Scale được mô phỏng bằng viewport CSS cộng với `deviceScaleFactor`:
  - 1920@125% → 1536×864 @1.25
  - 1920@150% → 1280×720 @1.5
  - 1920@200% → 960×540 @2
- Số đo gốc nằm trong `qa-measurements.json`.

**Chưa kiểm tra:**
- Cửa sổ Tauri native: maximize/restore thật, kéo mép cửa sổ, WebView2.
- Windows Display Scale thật, và đổi scale khi app đang chạy.
- Video thật qua asset protocol. QA dùng clip WebM data-URL, nên `duration` báo null.
- Font Be Vietnam Pro: chưa bundle, đang hiển thị bằng font fallback.
- Typography V2 chưa commit trên máy Windows.

## AC-R1..AC-R8

| AC | Nội dung | Kết quả | Bằng chứng |
|---|---|---|---|
| AC-R1 | Resize, maximize, restore không cắt action chính, không mất draft, không đè Canvas | **Pass (mock)** | Chuỗi resize 1920→1280×720→1000×768→800×600→1920: không có scroll ngang ở bước nào, CTA luôn thấy được (ở 800 thì nằm trong drawer), prompt phụ và selection còn nguyên. Ảnh `resize-1..5`, `resize-800x600-drawer-open`. Test `responsiveLayout.test.tsx`. Chưa thử maximize native. |
| AC-R2 | Chuyển giữa node ảnh, video, reference, job thì toolbar, Inspector và preview đổi đúng, không gọi API AI | **Pass** | `selection` trong JSON: mỗi node cho đúng loại toolbar và Inspector, video không có action ảnh. Ảnh `node-*.jpg`. Test `selection.test.ts`, `branchCanvas.test.tsx`; spy transport xác nhận không có lệnh ghi nào. |
| AC-R3 | Ảnh lớn hiển thị trọn, đúng tỉ lệ; Fit, 1:1, zoom, pan; Esc đóng | **Pass** | `viewer-image-fit` / `-100` / `-zoom-pan`. Zoom giới hạn 25–400%, pan được clamp, phím `0`/`1`/`+`/`-`, ←/→ dừng ở hai đầu tập. Test `viewer.test.tsx`. |
| AC-R4 | Video có play, seek, mute; đóng thì dừng tiếng; không giả poster | **Pass (mock clip)** | Mở viewer không autoplay; play, seek 2s, mute đều chạy; Stop → paused ở 0; sau khi đóng còn 0 video đang phát. Nhãn poster lấy theo `posterSource` (frame / source / chưa rõ). Ảnh `viewer-video-playing`. Chưa thử clip thật của Kling/Veo/Seedance. |
| AC-R5 | Quay lại Canvas vẫn giữ selection, pan/zoom, draft, scroll và focus | **Pass, trừ scroll chưa đo riêng** | Transform canvas trước và sau viewer giống hệt nhau: `translate(40px, 129.505px) scale(0.609091)`. Draft còn; focus trả về nút đã mở (có test). Đổi Studio ↔ Node giữ draft, selection và viewport (có test). Vị trí scroll của Inspector chưa có phép đo tự động; panel vẫn mounted nên về lý thuyết không đổi. |
| AC-R6 | Zoom Viewer, zoom Node Canvas và UI scale tách riêng | **Pass (mock)** | Zoom viewer là state cục bộ, zoom canvas lưu ở `nodeViewport`, còn scale chỉ đổi số CSS px dùng để chọn tier. Không có `transform: scale` cho toàn app. Ảnh `scale-1920-125/150/200`. |
| AC-R7 | Tooltip, modal, drawer, floating toolbar dùng được ở mép màn hình và viewport nhỏ | **Pass (mock)** | Toolbar node luôn nằm trong canvas, không đè thân node (`zoomTracking`, ảnh `node-zoomed-toolbar`). HelpPopover lật hoặc clamp theo mép (test `helpPopover.test.tsx`). Drawer ở 800×600 và 960×540 không gây scroll ngang. |
| AC-R8 | Chỉ xem preview không được sửa ảnh nguồn, metadata hay bằng chứng | **Pass** | Test viewer và selection dùng spy transport, cấm các lệnh `generation_submit`, `dna_update`, `asset_*`, `canvas_layout_save`, `job_*` và `workflow_confirm_step`. Viewer chỉ đọc file. |

## Ma trận E2 (đọc từ `qa-measurements.json`)

| Viewport | Tier | Short | Drawer | Scroll ngang | Panel | CTA |
|---|---|---|---|---|---|---|
| 1920×1080 | wide | – | – | không | 380 | thấy |
| 1440×900 (sau viewer) | regular | – | – | không | 380 | thấy |
| 1280×720 | regular | ✓ | – | không | 380 | thấy |
| 1000×768 | compact | ✓ | – | không | 360 | thấy |
| 1000×768 EN | compact | ✓ | – | không | 360 | thấy |
| 800×600 | narrow | ✓ | ✓ | không | drawer 380 | trong drawer |
| 1536×864 @1.25 | regular | – | – | không | 380 | thấy |
| 1280×720 @1.5 | regular | ✓ | – | không | 380 | thấy |
| 960×540 @2 | narrow | ✓ | ✓ | không | drawer 380 | thấy |

Action theo từng loại selection:

| Selection | Action |
|---|---|
| Ảnh AI | continue_from_ai, detail, grade, enhance, expand |
| Video | view_source, remake_video, play |
| Reference | reference_role, toggle_reference, expand |
| Job xong | show_outputs, copy_prompt, reuse_presets |
| Job đang chờ | copy_prompt, reuse_presets, cancel_job |

Ở chế độ chỉ đọc: `continue_from_ai` bị tắt và có nêu lý do, các action xem và chuyển ảnh vẫn dùng được, viewer vẫn mở.

## Ảnh chụp

- **Before (`main`):** `before/before-1920x1080`, `-1280x720`, `-1000x768`, `-800x600`, `before-branches-1920`
- **Resize:** `resize-1-1920x1080`, `resize-2-1280x720`, `resize-3-1000x768`, `resize-4-800x600`, `resize-800x600-drawer-open`, `resize-5-1920x1080-restored`
- **Node:** `node-none`, `node-image`, `node-video`, `node-reference`, `node-job-complete`, `node-job-pending`, `node-zoomed-toolbar`
- **Viewer:** `viewer-image-fit`, `viewer-image-100`, `viewer-image-zoom-pan`, `viewer-video-playing`
- **Khác:** `readonly-image`, `scale-1920-125`, `scale-1920-150`, `scale-1920-200`, `en-compact-1000`

## Giới hạn và phần chưa làm

- **V6.2–V6.5 chưa làm:** compare nâng cao, annotation, thao tác nhiều node, Pin Preview, undo/redo.
- Nút "mở thư mục" chưa có vì chưa có lệnh Tauri.
- Tất cả các mục trong phần "Chưa kiểm tra" ở trên cần chạy lại trên máy Windows thật trước khi duyệt.
