# wt/interior-create-menu

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-24 01:02

## Mục tiêu

Theo yêu cầu ngày 24/10: đưa Không gian và lựa chọn Ánh sáng vào Tạo ảnh Nội thất; bỏ Không gian, Style, Hiệu ứng và Ánh sáng khỏi menu trái Nội thất. Giữ menu Công trình.

## Đã xong

- `InteriorOptions` thêm hai nút có icon ngay dưới ảnh nguồn trong Generate. Không gian mở lại DNA editor/catalog/context đang có; Ánh sáng mở sáu lựa chọn nội thất cùng AI gợi ý. Không tạo engine/provider/schema mới.
- Khi chỉnh phòng trong Không gian (kể cả AI hoặc catalog), đóng hộp lựa chọn sẽ đưa phòng đã đổi vào draft tạo ảnh; giữ nguồn, instruction, style, khóa và camera hiện tại.
- Bỏ bản lựa chọn ánh sáng trùng trong Tùy chỉnh thêm. Giữ camera và instruction ở đó; cập nhật hướng dẫn VI/EN tương ứng.
- `workspaceModuleForProject` thống nhất route cho menu, các đường dẫn cũ, tạo dự án và chọn ảnh tham chiếu ở Node: các module Nội thất đã bỏ đi về Generate. Công trình vẫn giữ các module cũ.
- Không xóa dữ liệu DNA/Hiệu ứng hoặc tài sản cũ; không thay đổi Rust/database.
- Test hồi quy đã tái hiện trước sửa: menu Nội thất còn các nút thừa; Generate chưa có nút Không gian; chọn node tham chiếu mở lại module đã ẩn. Sau sửa các kiểm tra tương ứng đạt.
- Cập nhật hai test cũ để đi theo luồng mới (Context Nội thất về Generate, ánh sáng mở bằng nút trong Generate).

## Kiểm tra

- Typecheck, lint và frontend production build đạt.
- Ba browser acceptance chạy đạt: `interior-generation.mjs`, `reference-assist.mjs`, `npm run test:ui`. Test chọn phòng, ánh sáng, source/reference, Style, Prompt, Node, video, vùng chọn, màu, xuất/tải ảnh và kích thước cửa sổ. Không lỗi JavaScript trong luồng mới; đã xem ảnh chụp Không gian và Ánh sáng.
- Test Compose gửi đúng phòng và preset ánh sáng đã chọn, không mất instruction hay nguồn ảnh.
- Toàn bộ frontend/domain chạy lại sau điều chỉnh test theo menu mới: 120 file, 1.262 test đạt (67,49 giây). Prettier các file thay đổi và git diff --check đạt.

Lệnh:

```powershell
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm run build -w @arch/desktop
npm test -- --maxWorkers=2 --reporter=dot
node tools/qa/interior-generation.mjs
node tools/qa/reference-assist.mjs
npm run test:ui
git diff --check
```

## Giới hạn và tích hợp

- Browser dùng mock; không gọi AI trả phí hoặc viết vào dự án thật. Chưa chạy cửa sổ native Tauri hoặc build bộ cài Windows trong đợt này.
- Cảnh báo bundle >500 kB và cảnh báo media method của JSDOM đã có sẵn.
- Tiếp tục theo yêu cầu trước đó của người dùng về test rồi gộp main; chỉ gộp khi các kiểm tra đạt, không push GitHub. Đây không phải review của Claude.
- Worktree riêng: `D:/worktrees/IMAGE-CREATIVE-ARCHITECT-github/interior-create-menu`; base `4fa958d`.
