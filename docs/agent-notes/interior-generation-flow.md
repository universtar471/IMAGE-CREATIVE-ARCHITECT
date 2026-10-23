# Bàn giao — wt/interior-generation-flow

- Agent: Codex.
- Worktree: `D:\worktrees\IMAGE-CREATIVE-ARCHITECT-github\interior-generation-flow`.
- Tách từ `main` tại `aa2efa7`.
- Phạm vi: đặc tả người dùng ngày 23/10/2026 về thiết kế lại Tạo ảnh → Nội thất.
- Người dùng đã yêu cầu kiểm tra tích hợp với main rồi gộp. Việc gộp thực hiện từ checkout main sau khi các kiểm tra đạt.

## Đã hoàn thành

- P0: structured state phiên bản 1; config preset; composer và conflict resolver; sáu mục tiêu; chín loại phòng; lưới style nhỏ; bốn mức thay đổi; năm khóa giữ nguyên; SVG dùng lại Lucide; nút Tạo ảnh sticky.
- P1: gợi ý đúng ba style và ánh sáng qua chat/vision; ảnh tham chiếu trong Style với quyền học riêng; sáu góc camera và sáu kiểu sáng nội thất; phân loại bề mặt trong vùng chọn; các thao tác sau kết quả qua công cụ hiện có.
- Giữ shell, provider/quality picker, xác nhận chi phí, hàng đợi, Node, assets, history, DNA và Camera Director. Không migration cơ sở dữ liệu; các lựa chọn cũ được giữ trong workspace/storage.
- Đồng bộ Prompt/Node và thay nguồn ảnh với state mới; Hoàn tác khôi phục cả ảnh nguồn, shot state và bản nháp. Nguồn ảnh quyết định thứ tự Image 1, khung hình đầu ra và quan hệ ảnh cha; ảnh tham chiếu có role Master không được thay nguồn.
- Bản báo cáo chi tiết file/component/state/prompt/icon: `docs/interior-generation-workflow.md`; quyết định kiến trúc: ADR-051 trong `docs/DECISIONS.md`; wire contract: mục 24 trong `docs/API_CONTRACTS.md`.

## Kiểm tra

- `npm run typecheck`: đạt (domain và desktop).
- `npm run lint`: đạt.
- `npm test -- --maxWorkers=2 --reporter=dot`: 1.232 kiểm tra đạt, 114 file (gồm regression bổ sung lúc kiểm tra tích hợp).
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --jobs 2 -- --test-threads=2`: 372 đạt, 6 bỏ qua có sẵn; không có lỗi.
- `npm run build -w @arch/desktop`: đạt.
- `npm run build`: đạt; đóng gói Windows NSIS `.exe` và MSI, phiên bản hiện tại 0.1.0.
- `node tools/qa/interior-generation.mjs`: đạt ở 1280×720, 1440×1000 và 1920×1080. Lưới ba cột, sticky Generate, xử lý xung đột, AI chỉ phân tích, source/reference đúng thứ tự, tiếp tục từ ảnh kết quả; không lỗi JavaScript.
- `npm run test:ui`: đạt lại cho luồng Công trình/Node hiện có: import, chọn nguồn, bản nháp, video, upscale, vùng chọn, chỉnh màu, batch, diagram/publishing, tải ảnh gốc và đổi kích thước cửa sổ. Không có ghi dữ liệu ngoài mock.
- Kiểm thử dùng mock/cục bộ, không phát sinh cuộc gọi AI trả phí. Đã kiểm tra ảnh chụp giao diện workflow và lưới style.
- Các regression đã có test đỏ trước khi sửa: lỗi thứ tự source/reference, mất legacy selection khi state mới không đọc được, bypass khóa khi gửi lại snapshot, reference màu xung đột material lock, nhận nhầm “ban đêm”/“tự nhiên” là đồ nội thất, nhầm đổi màu tường với đổi kiến trúc, giữ nhầm purpose Variation, khung hình lấy từ ảnh khác, Hoàn tác không khôi phục nguồn Node, lineage nhận nhầm ảnh tham chiếu Master.

## Lưu ý / giới hạn

- Rà soát tích hợp 23/10/2026: `origin/main` vẫn ở `aa2efa7`, là tổ tiên của nhánh; rebase không cần giải quyết xung đột. Kiểm tra lại các thay đổi chung ở store, compiler, provider, vùng chọn, Prompt/Node và dữ liệu dự án cũ.
- Đã bắt lỗi hồi quy trước khi sửa: `setGenerateDraft` lưu state mới vào workspace/localStorage nhưng chưa cập nhật cache theo dự án trong phiên. Khi mở lại dự án, cache cũ khôi phục sai Prompt/ảnh nguồn. Đã đồng bộ cache và thêm test mở lại dự án sau khi sửa Prompt/nguồn Node.

- Không tự xóa asset, history hoặc output khi Hoàn tác. Đây là thao tác quay về ảnh nguồn và lựa chọn trước lượt tạo, không phải xóa dữ liệu.
- Camera Director có cameraId cụ thể vẫn dùng compiler cũ. Các cấu hình DNA nâng cao của đường dẫn này vẫn được giữ; các lựa chọn Tạo ảnh mới được lưu riêng trong shot intent để tránh kéo các preset/material cũ vào prompt mới.
- Conflict resolver nhận diện các mẫu Việt/Anh có giới hạn và xung đột lựa chọn có cấu trúc. Không khẳng định hiểu mọi cách diễn đạt tự nhiên. “Giữ khóa” loại bỏ câu xung đột đang hiển thị sau thao tác xác nhận của người dùng.
- Hard lock trong prompt không bảo đảm mô hình sinh ảnh giữ hình học tuyệt đối. Chỉnh vùng vẫn dùng cơ chế mask/composite hiện có để bảo vệ pixel ngoài vùng.
- Chưa kiểm thử trả phí chất lượng vision/style/surface hoặc ảnh sinh thật. Không giả nhận xét AI đã được đo đạc chính xác.
- Cảnh báo bundle JavaScript lớn hơn 500 kB đã tồn tại; build vẫn thành công. JSDOM báo thiếu triển khai một số phương thức media, nhưng các test liên quan đều đạt.
- Khi đổi source phải xóa sourceAnalysis cũ. Không dùng role lưu trong thư viện làm quyền sao chép ảnh tham chiếu ở request mới.
- Các test vị trí Reference trong Space và recipe ngoại thất đã được cập nhật theo đặc tả mới: Reference thuộc Style; Interior dùng Goals thay recipe ngoại thất. Các test Architecture vẫn đạt.

