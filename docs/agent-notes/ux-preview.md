# wt/ux-preview

## Mục tiêu

Hoàn thành preview trực quan cục bộ cho ánh sáng, mood/grade và bối cảnh theo ADR-029.

## Đã xong

- Thêm SVG preview ánh sáng theo thời điểm, hướng và cao độ mặt trời, độ dài/mềm bóng, ánh sáng môi trường và đèn cửa sổ; thêm thẻ preset có xem lớn khi hover/focus.
- Thêm preview mood với lớp màu và palette; giữ select preset hiện tại để tương thích quy trình, đồng thời thêm thẻ preset trực quan.
- Thêm preview grade trên ảnh master (hoặc asset được chọn nếu chưa có master), chế độ trước/sau/chia đôi và thẻ grade preset. Ảnh được đọc qua URL cục bộ của managed file/thumbnail, không gọi lệnh backend.
- Thêm sơ đồ bối cảnh nhìn từ trên xuống theo topology, mật độ, đường trước nhà, cây và preset; nội thất có sơ đồ phòng cùng hướng sáng tự nhiên.
- Thêm title tiếng Việt/Anh có thể truy cập cho SVG, CSS thích ứng panel và bộ test DOM cho thuộc tính SVG, preset thumbnail, grade fallback/master, topology và nội địa hóa.
- Không thêm dependency, không ghi ảnh preview, không gọi API trả phí.

## Còn nợ

Không còn việc trong phạm vi brief.

## Lệnh kiểm tra

- `npm.cmd run verify` — đạt. Typecheck và lint đạt; Vitest: 44 file, 524 test đạt; Rust: 272 đạt, 0 lỗi, 6 ignored.
- `node node_modules/prettier/bin/prettier.cjs --check .` — đạt.
- Test mới: `node node_modules/vitest/vitest.mjs run apps/desktop/tests/previews.test.tsx --pool=threads --maxWorkers=1 --reporter=verbose` — 6 đạt.

## Cạm bẫy

- Trên PowerShell hiện tại, `npx` gọi `npx.ps1` bị chặn bởi Execution Policy; dùng `npm.cmd` hoặc gọi trực tiếp `node node_modules/...`.
- Một lần chạy Vitest riêng bị timeout lúc tạo fork worker; chạy lại và lệnh verify đầy đủ đều đạt. Worktree chậm khi nhiều worker khởi chạy đồng thời.
- `resolveSiteTopology` dùng giá trị explicit trước inference từ mô tả; preview dùng đúng helper domain để hiển thị topology.
