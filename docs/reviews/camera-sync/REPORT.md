# Đồng bộ góc Camera — bản local để duyệt

Repository: `universtar471/IMAGE-CREATIVE-ARCHITECT`.
Base main: `04e5c8d0a5e71080e70649f3c2f455d6ea983098`.
Branch kiểm tra/sửa: `feature/multi-angle-camera-m1-sync`, worktree
`/workspace/scratch/797f52af00a3/multi-angle-main-check`.
Nhánh M1 ban đầu và các bản bàn giao trước vẫn được giữ nguyên. Không commit, merge, push
hoặc thao tác ghi remote.

## Kết quả sửa

- Workflow Tạo ảnh nội thất, bảng Camera bên phải, Orbit và Director cùng tham chiếu Camera DNA bằng CAM ID; không lưu thêm bản pose song song trong workflow.
- Chọn preset tại Generate hoặc inspector cập nhật camera đang chọn. Kéo Orbit, dùng phím trong Director, sửa trường Camera DNA hoặc áp dụng đề xuất camera đã duyệt cập nhật liên kết ngược về mode Camera Studio.
- Các lựa chọn preset nội thất dùng chung bảng tọa độ và tiêu cự; nút thêm camera dùng cùng bảng, có nhãn riêng để phân biệt “thêm camera mới” và “áp dụng lên camera đang chọn”.
- Prompt structured interior đọc đúng azimuth/elevation/distance/height/lens, dùng quy ước room-local; không gọi các mặt của phòng là mặt tiền/side facade. Snapshot của camera được copy riêng vào metadata, hash thay đổi theo DNA; không sửa các kết quả sinh trước.
- Sửa hướng preset công trình: Trái 45° = +45°, Phải 45° = −45°, đồng nhất với Camera Director. Khoảng cách không bị nhầm với zoom quang học.
- Kéo chuột lưu góc với độ chính xác 0,1°; Orbit hiển thị góc lẻ thay vì làm tròn thành số nguyên. Reset khôi phục pose, view type, lens và metadata preset của phiên chỉnh sửa.
- Mở lại dự án chọn lại CAM đang được workflow liên kết, kể cả khi đó là camera thứ hai trở đi.
- Xóa camera liên kết sẽ chặn tạo ảnh và báo lỗi rõ; không chọn ngầm một camera khác. Chọn camera/preset mới là thao tác sửa liên kết tường minh.

## Khóa và phạm vi

“Giữ góc ảnh gốc” không bị tự tắt. Khi bật khóa (hoặc Change Level 0), các thay đổi trên
camera đang bố trí chỉ là bản nháp, không thay góc của workflow Generate. Trạng thái khóa
hiển thị cùng nút mở khóa; chỉ thao tác mở khóa rõ ràng mới dùng camera đã bố trí. Đổi ảnh
nguồn trả về góc gốc và khóa góc như thiết kế hiện hành. Không giả suy ra tọa độ camera của
ảnh 2D khi chọn Original. Dự án archived không nhận sửa DNA hay shot state.

Nội thất dùng bảng điều khiển dùng chung mới; công trình vẫn dùng luồng và ràng buộc site
hiện hành. Không thêm module điều hướng, không thay History Graph, không chạy AI khi kéo.
Không sửa Rust/SQLite hoặc migration. Trường mới được giữ trong ShotIntent.extra JSON của
backend hiện hữu. Phiên bản prompt mới: `pc-1.12.0` / `ig-1.1.0`.

## Kiểm chứng

| Kiểm tra cuối | Kết quả |
|---|---|
| Typecheck, ESLint, production frontend build | PASS |
| Domain + desktop | 119 file, 1.252/1.252 test PASS |
| Chromium 1440×900 | PASS, 0 page errors, 0 paid commands |
| Mẫu Prompt đã kiểm tra | azimuth 68,5°; elevation −6,5°; distance 1,5 m; lens 50 mm |
| Native Rust/Tauri | Chưa chạy được: thiếu Cargo |

Log cuối nằm trong `logs/`, kết quả browser trong `browser-results.json`.

- Test mới kiểm tra stable links/legacy state, exact room-local prompt, hard lock, mất camera,
  immutable snapshots/hash; DOM kiểm tra preset ↔ Orbit/Director ↔ Generate, lưu/mở lại
  camera thứ hai, source relock, archived và giữ pose khi chọn Camera Studio.
- Các test version được cập nhật theo phiên bản compiler mới; test camera trước đây bỏ qua
  azimuth nội thất được cập nhật để yêu cầu góc room-local. Test preset “thêm camera Detail”
  yêu cầu cùng tọa độ/tiêu cự với bộ preset chung, không còn giá trị lệch riêng ở mỗi UI.
- Chromium 1440×900 thao tác thực trên ứng dụng: unlock tường minh, chọn preset ở inspector,
  xác nhận tại Generate, chọn Detail ở Generate, mở Orbit, kéo chuột và phím Director,
  kiểm tra Prompt snapshot và mở lại đúng camera. VI/EN, không page errors, không paid commands.
- Có `compiled-prompt.txt` để xem góc thực tế đã đưa vào Prompt, và ảnh Orbit VI/EN.
- Frontend/domain dùng mock persistence, không gọi API trả phí. Chưa xác nhận Tauri/native
  SQLite trên Windows vì container thiếu Cargo; chưa đo chất lượng ảnh sinh thật.
- Proxy vẫn là hình học ước tính; không bảo đảm AI tái dựng đúng mặt khuất, tỷ lệ thật hoặc
  tránh va chạm tường. Các tính năng geometry/QC vẫn thuộc M4.

Các báo cáo trong thư mục `main-compatibility` và `multi-angle-m1` là bằng chứng lịch sử trước
lượt sửa này; báo cáo camera-sync này mô tả hành vi mới nhất.
