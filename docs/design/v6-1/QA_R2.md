# V6.1-R2 — sửa các khoảng trống sau kiểm tra repository

Ngày kiểm tra: 2026-10-20, Windows 11. Tác vụ sửa và merge được người dùng giao trực tiếp.
R2 bổ sung cho báo cáo R1 trong `QA_REPORT.md`; không triển khai toàn bộ roadmap V6.2–V6.5.

## Đã sửa

- Chọn node ảnh/video/reference chuyển cả module và panel tương ứng. Chọn lại cùng node
  không ghi đè công cụ vừa chọn từ toolbar; multi-selection không ép đổi module.
- Bản nháp video (motion, note, provider/model, duration, ratio) nằm trong session store,
  giữ lại khi đổi panel và đặt lại khi mở project; bản nháp ảnh không bị thay đổi.
- Viewer có nút fullscreen thật bằng Fullscreen API khi môi trường hỗ trợ, nút thoát,
  báo lỗi khi request bị từ chối, và thoát fullscreen khi đóng viewer.
- Dừng player workspace khi mở viewer để không phát âm thanh phía sau.
- Khôi phục `src` của video sau vòng cleanup/setup của React StrictMode. Trước sửa,
  viewer mất URL và kẹt ở Loading; unit regression và kiểm tra phát WebM đều tái hiện lỗi.
- Đóng gói Be Vietnam Pro 400/500/600/700 kèm SIL OFL 1.1, không gọi Google Fonts khi chạy app.
- Thêm workflow Verify trên Windows cho PR/main: typecheck, lint, format, Vitest, build,
  Playwright, rustfmt, clippy và Rust tests. Artifact QA được upload từ workflow.

## Kiểm chứng

Các lỗi panel, fullscreen, âm thanh nền và StrictMode đều có test tái hiện trước khi sửa.

- TypeScript typecheck, ESLint, Prettier và Vite production build: đạt.
- Vitest: 101 file, 1136 test đạt.
- Rust trên Windows: 366 đạt, 6 live provider test bỏ qua; rustfmt và clippy `-D warnings` đạt.
- `npm run test:ui`: đạt trên Chromium headless với backend giả lập cô lập. Video là WebM
  do MediaRecorder tạo trong test, được trình duyệt thực sự decode/phát; không gọi provider AI.
- Resize 1920×1080 → 1280×720 → 1000×768 → 800×600 → 960×540 → 1920×1080:
  không tràn ngang, giữ bản nháp và asset selection.
- Click node video/reference/ảnh: toolbar và panel đồng bộ.
- Fullscreen API được gọi thật; `document.fullscreenElement` xác nhận vào/thoát.
- Inspector giữ scrollTop 160 sau resize và vòng mở/đóng viewer.
- Font bundled tải thành công. Workspace player dừng khi mở viewer; không còn player
  đang chạy sau khi đóng. Spy transport không ghi nhận lệnh ghi hay submit generation.

Số đo: [r2-measurements.json](r2-measurements.json).
Ảnh: [panel video](r2-node-video.png), [800×600](r2-resize-800x600.png),
[960×540](r2-resize-960x540.png), [fullscreen](r2-viewer-fullscreen.png).

Chạy lại: `npm ci`, `npx playwright install chromium`, `npm run test:ui`.
Ảnh/số đo mặc định nằm trong thư mục temp; đặt `QA_OUTPUT_DIR` để chọn thư mục artifact.

## Giới hạn còn lại

- Đây là Chromium headless trên Windows, chưa phải thao tác maximize/restore cửa sổ Tauri
  hay đổi Windows Display Scale thật. Video qua asset protocol của WebView2 cần QA thủ công.
- Không đưa vào các file Typography V2 chưa commit ở worktree khác.
- Nút mở file/thư mục native, Pin Preview, annotation, compare nâng cao, Draft Workflow,
  Context Picker V6 và undo/redo vẫn là phạm vi sau V6.1.
- Kết quả GitHub Actions được đọc riêng từ PR; các số liệu trên là lần chạy tại máy Windows.
