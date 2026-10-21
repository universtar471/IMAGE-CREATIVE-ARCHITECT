# wt/generation-source-dedupe

## Mục tiêu
Sửa nút tạo ảnh bị khóa do ảnh nguồn thường bị thêm hai lần vào danh sách tham chiếu.

## Đã xong
- Loại chính ID nguồn khỏi tham chiếu phụ trước khi áp giới hạn số ảnh, giữ nguồn ở vị trí đầu.
- Thêm regression tests cho ảnh nhập ngoài, ảnh AI, giới hạn tham chiếu và nút Generate hero.
- Kiểm tra tạo ảnh qua store/mock từ ảnh thường khi chưa có Master hoặc DNA xác nhận.
- Browser QA kiểm tra nút tạo ảnh bật khi chọn một ảnh thường làm nguồn.

## Lệnh test
`npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test -- --maxWorkers=4`, `npm run build -w @arch/desktop`, `npm run test:ui`.

## Cạm bẫy
Trước đây bộ lọc chỉ bỏ role sketch/master. Khi mở rộng nguồn sang regular_image, nguồn bị giữ lại trong tham chiếu phụ. Không bỏ kiểm tra duplicate ở backend: lỗi nằm tại bước ghép form.

## Còn nợ
Không gọi provider có phí; luồng tạo được xác nhận qua backend mock, UI và browser.

## Kết quả
Typecheck, lint, format, production build: đạt. 102 file / 1.145 test đạt. Browser QA đạt, importedSourceCanGenerate=true. Ba regression case tái hiện lỗi trước sửa.
