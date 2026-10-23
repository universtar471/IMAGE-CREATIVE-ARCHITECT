# Kiểm tra M1 với main mới — 23/10/2026

Kết luận: bản thay đổi M1 áp dụng ba chiều lên `main` mới không có xung đột Git. Không cần sửa mã sản phẩm để ghép. Kiểm tra hành vi dùng chính domain và dependencies của worktree mới, không dùng domain của bản M1 cũ.

## Mốc kiểm tra

- Base M1: `aa2efa7c942c40a6f7db70fc74b70adc76bd6bcd`.
- Main mới: `04e5c8d0a5e71080e70649f3c2f455d6ea983098` — Merge structured interior generation after compatibility checks.
- Chênh lệch upstream: 5 commit, 59 file; phần lớn là workflow tạo ảnh nội thất, composer có cấu trúc, bảo toàn Prompt/nguồn ảnh khi mở lại.
- M1 gốc: `feature/multi-angle-camera-m1`, vẫn là các thay đổi chưa commit; không thể chỉ dùng `git merge feature/...` để mang những thay đổi chưa commit này sang main.
- Mô phỏng: `/workspace/scratch/797f52af00a3/multi-angle-main-check`, detached tại main mới; áp dụng snapshot M1 bằng `git apply --3way`, không tạo merge commit.

## Tệp giao nhau

Chính xác 3 tệp được cả upstream mới và M1 thay đổi:

| Tệp | Phần mới trên main | Phần M1 | Kết quả |
|---|---|---|---|
| `apps/desktop/src/app/store.ts` | Giữ state tạo ảnh nội thất, Prompt/Node, nguồn ảnh, cache theo dự án và gate khóa | CenterView `orbit`, trở về canvas khi rời Camera | Ghép sạch, giữ cả hai |
| `apps/desktop/src/i18n/en.ts` | Chuỗi workflow nội thất | Nhóm `multiAngle` | Ghép sạch, không trùng nhóm |
| `apps/desktop/src/i18n/vi.ts` | Chuỗi workflow nội thất | Nhóm `multiAngle` | Ghép sạch, đúng shape VI/EN |

`ProjectWorkspace.tsx`, module camera/geometry, schema Camera DNA và mã mô tả camera không đổi trên upstream lần này. `docs/PROGRESS.md` chỉ được M1 thay đổi, không phải điểm giao nhau của hai bên.

## Kiểm tra

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run build -w @arch/desktop`: PASS; vẫn có cảnh báo JS chunk >500 kB.
- Bộ test domain/desktop của main mới + M1: 116 file, 1.242 test PASS trước khi bổ sung test giao thoa.
- Test giao thoa bổ sung: `apps/desktop/tests/multiAngleMainCompatibility.test.tsx`. Chỉnh Orbit trong dự án đang có structured interior-generation, bảo toàn Prompt/nguồn Node, chọn đúng compiler theo cameraId, lưu/mở lại và bảo toàn shot-intent cache. Hồi quy cuối: **117 file, 1.243/1.243 test PASS** (`tests-final.log`).
- Chromium Orbit 1440×900: PASS; kéo chuột, cảm ứng, bàn phím, preset, help/Escape, cancel, scope, lưu/mở lại mock; không có paid commands hoặc page errors.
- Chromium workflow nội thất mới: PASS ở 1280×720, 1440×1000 và 1920×1080; 0 page errors. Các generation/assist trong kịch bản này đều đi qua mock transport, không phải API trả phí.
- Chromium Node/History hiện có: PASS; nguồn ảnh, draft, video, vùng chọn, grade, batch, diagram/publishing và download đều qua mock.
- Hai script browser có sẵn của main chạy với cùng logic kiểm thử; wrapper tạm chỉ thay đường dẫn/flags khởi chạy Chromium cho môi trường container. Wrapper đã được xóa.
- Không có file unmerged. Snapshot diff của worktree M1 gốc vẫn giữ nguyên hash `cc8e1c755162c927017cda340596f8ced20104ad385f0e5e9ed01aa2b7b7c731`.

## Giới hạn và quyết định trước gộp

- Orbit/Director chỉnh **Camera DNA**. Góc camera của **workflow Tạo ảnh nội thất mới** nằm trong `shotIntent.interiorGeneration.camera`; không tự đồng bộ hai cấu hình.
- Khi request có `cameraId`, compiler vẫn dùng đường Camera DNA. Khi không có `cameraId` và có structured interior-generation, main dùng composer mới. Test giao thoa bảo vệ ranh giới này.
- Với viewType nội thất, mã mô tả camera hiện hữu không xuất azimuth mặt tiền thành số độ; vì vậy không khẳng định xoay Orbit sẽ tự đổi ảnh sinh bởi workflow mới. Đây là giới hạn đã có của đường Camera/đặc tả M1, không phải xung đột merge do bản cập nhật này. Cần thiết kế liên thông trong M2 trước khi quảng bá Orbit như điều khiển mọi tác vụ Generate.
- Chưa chạy Rust/Tauri/SQLite native trong container do thiếu Cargo. Không thay Rust trong M1. Kết quả browser dùng backend giả lập.
- Chưa commit, chưa gộp vào main hoặc nhánh M1, chưa push, chưa tạo PR và chưa thay repository remote.

Đề xuất: về mặt Git và kiểm thử frontend/domain, có thể chuẩn bị gộp M1 trên mốc main nêu trên. Trước khi gộp thật cần lưu M1 thành commit local và kiểm tra lại HEAD main nếu remote tiếp tục cập nhật. Chỉ thao tác remote sau khi người dùng duyệt rõ ràng.
