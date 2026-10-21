# wt/draft-download-grade

## Mục tiêu

Sửa sáu lỗi người dùng báo: kéo node nháp, xem graph ở sơ đồ/xuất bản, vẽ vùng và menu, tải ảnh/video, preview mood tràn, danh sách/so sánh áp màu hàng loạt.

## Đã xong

- Cho phép kéo và lưu vị trí node nháp, giữ viewport khi kéo ở vùng xa.
- Mở Studio/Node cho diagram và publishing; giữ bảng setting của module khi xem graph.
- Đưa toolbar lên trên overlay; chuẩn hóa tọa độ vẽ theo bounding rect thực tế. Đồng bộ vùng mới/đổi tên/xóa giữa canvas và menu.
- Rút gọn hướng dẫn chỉnh vùng vào (?), sửa heading dài, style input/textarea và bố cục hàng vùng, thêm icon hành động.
- Tải từng ảnh/video từ node và tray, hoặc các file được đánh dấu. Lưu original qua folder picker native, kiểm tra quyền sở hữu asset, không ghi đè file có sẵn hay ghi vào thư mục dự án đang xuất. Không dùng thumbnail làm file tải.
- Giới hạn GradeCanvas trong center-body; vạch chia đôi hiển thị ở kích thước preview. Nhãn trước/sau rõ hơn.
- Grid chọn ảnh hàng loạt giữ chiều cao tối thiểu, cuộn và kéo đổi chiều cao được; nội dung dialog cuộn riêng.

## Kiểm chứng

- Tái hiện đỏ trước sửa: draft không draggable, Node bị khóa ở diagram/export; test Rust xuất file ban đầu không biên dịch do thiếu implementation.
- npm run typecheck; npm run lint; npm run format:check: đạt.
- npm test: 1166 passed / 107 files.
- cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml: 367 passed, 6 ignored (provider thực).
- cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings: đạt.
- npm run build -w @arch/desktop: đạt.
- npm run test:ui: đạt; thực sự kéo draft ở zoom 0.25 và kiểm tra vị trí lưu, mở graph ở hai module, vẽ rect đúng tọa độ và thấy trong panel, tải file browser, so sánh pixel trước/sau và hai nửa split trong mood lẫn batch.
- Ảnh QA và measurements nằm trong temp phiên, lần cuối C:/Users/Admin/AppData/Local/Temp/ica-v61-OYB3ER.

## Cạm bẫy / giới hạn

- Toolbar không có z-index trước đây bị region-overlay z-index 2 che. rect của ImageViewer là tọa độ local, không thể trừ trực tiếp khỏi clientX/Y.
- Canvas putImageData không dùng clip paths; giữ dirty rectangle để ghép hai nửa. Vạch 2 pixel nguồn rất mảnh khi ảnh lớn thu nhỏ nên độ dày hiện tính theo tỷ lệ hiển thị.
- Fixture browser cần PNG thực để createImageBitmap giải mã, không dùng SVG placeholder cho kiểm tra GradeCanvas.
- Nút Auto-select vùng vẫn là tính năng tương lai có sẵn; rect, polygon, brush, select và mask là các công cụ hiện có.
- Không gọi provider trả phí hoặc đọc API key. Native folder picker chưa được thao tác trực tiếp; service copy có test file thật và frontend invoke có test riêng.
- Cần khởi động lại app Tauri để nạp command asset_download mới.

## Còn nợ

Không còn hạng mục trong sáu yêu cầu đang xử lý. Chờ CI Windows trước merge.
