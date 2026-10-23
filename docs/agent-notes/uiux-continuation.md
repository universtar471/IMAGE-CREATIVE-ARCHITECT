# wt/uiux-continuation

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-23 23:22

## Mục tiêu

Tiếp tục UI/UX theo yêu cầu trực tiếp của người dùng; kiểm tra code trước khi sửa, giữ kiến trúc hiện có.

## Trạng thái lúc nhận

- Repo dùng: `D:/IMAGE-CREATIVE-ARCHITECT-github`, main sạch tại `25fe20b`.
- `D:/IMAGE-CREATIVE-ARCHITECT` là checkout khác, có lịch sử local cũ hơn (ahead 17/behind 22 so với origin/main đã lưu). Không đồng bộ hoặc sửa checkout đó.
- Đã có ADR-049/051: tạo dự án tên + Nội thất/Công trình, Room/Prompt/Node, vật liệu trong Chỉnh vùng, workflow Nội thất mới và AI recommendation engine. Không viết lại những phần này.

## Đã xong

- Nối `SpaceReferences` vào inspector References của Công trình: nhập ảnh, thumbnail, chọn ảnh, AI gợi ý và metadata. Trước đó component chưa được mount, inspector chỉ có metadata.
- Catalog reference theo loại dự án: Building cho Công trình, Interior cho Nội thất, cộng lighting/mood/camera tương ứng, loại field trùng. Không còn ép catalog Nội thất lên Công trình.
- AI dùng chung chọn trước ảnh tham chiếu vừa nhập sau khi control đã mount; loại id ảnh không còn tồn tại khi mở lại. Danh sách ảnh có thumbnail, giới hạn chiều cao, không đổi lựa chọn trong lúc chờ AI.
- Khung AI vừa với panel, tránh tràn chiều ngang. Có icon cho AI, mode, dịch, tiếp tục, áp dụng, thử lại và đóng.
- Style riêng mặc định 6 mẫu cho cả hai loại dự án; giữ mẫu đang chọn trong sáu mẫu; mở toàn bộ bằng dialog rồi xem lớn/áp dụng qua luồng cũ.
- Thêm icon cho Add to Prompt/Node, Apply Style, danh mục Style và các nút nhận/thử lại/cài đặt của AI Nội thất.
- Không sửa domain schema, backend, migrations, provider hoặc dữ liệu dự án.

## Kiểm chứng

- Test tái hiện trước sửa: 3 lỗi reference và 1 lỗi menu Style có 15 mẫu thay vì 6 đều đỏ; sau sửa đều đạt.
- Typecheck, lint, frontend production build đạt. Prettier các file thay đổi đạt.
- `node tools/qa/reference-assist.mjs`: form tạo dự án hai lựa chọn, reference AI đúng catalog, ảnh mới được chọn, Apply rõ ràng, khung AI không tràn ở 1280/1440/1920; menu Style Nội thất sáu mẫu + toàn bộ. Không lỗi JavaScript.
- `node tools/qa/interior-generation.mjs`: luồng Nội thất đạt ở 1280×720, 1440×1000, 1920×1080; gợi ý AI, ảnh nguồn/tham chiếu, xung đột khóa và tạo biến thể qua mock đạt.
- `npm run test:ui`: Công trình/Node/video/vùng chọn/chỉnh màu/export/download/responsive 800–1920 đạt.
- Kiểm tra ảnh chụp trực quan; artifact được lưu trong outputs của chat, ngoài repo.
- Toàn bộ frontend/domain đã chạy lại sau thay đổi cuối: 120 file, 1.260 test đạt (63,35 giây).

Lệnh từ worktree:

```powershell
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm test -- --maxWorkers=2 --reporter=dot
npm run build -w @arch/desktop
node tools/qa/reference-assist.mjs
node tools/qa/interior-generation.mjs
npm run test:ui
git diff --check
```

## Còn nợ / cạm bẫy

- Chưa gọi AI trả phí hoặc kiểm tra vision với key thật. Browser acceptance dùng backend giả lập, không ghi project thật.
- Chưa kiểm tra cửa sổ Tauri/WebView2 và chưa build/install bộ cài. Không có thay đổi Rust nên không chạy lại Rust suite.
- Cảnh báo bundle >500 kB còn tồn tại; build vẫn đạt. JSDOM in cảnh báo media method chưa triển khai; acceptance browser chạy đạt.
- Thumbnail Style Công trình vẫn dùng placeholder khi catalog chưa có ảnh phù hợp, theo quy tắc có sẵn.
- Không push hoặc merge. Cần review ĐẠT trước khi merge main theo quy trình của người dùng.
- QA phải chờ thumbnail tải xong trước chụp hình; chờ DOM tồn tại chưa bảo đảm ảnh đã hiển thị.

