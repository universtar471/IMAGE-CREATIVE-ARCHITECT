# Review p4-backend — vòng 1

## Kết luận: PHẢI SỬA

## PHẢI SỬA (chặn merge)

- [grade.rs:357](/D:/worktrees/IMAGE-CREATIVE-ARCHITECT/p4-backend/apps/desktop/src-tauri/src/services/grade.rs:357) — Đường dẫn test vectors đi lên bốn cấp từ `apps/desktop/src-tauri`, ra ngoài repo. Sau khi P4-A thêm `packages/domain/test-vectors/grade.json`, test vẫn dùng vectors fallback nội bộ và không kiểm tra parity với TS như brief yêu cầu. Sửa thành `../../../packages/domain/test-vectors/grade.json` và xác nhận test chọn file domain sau merge.

- [grade.rs:35](/D:/worktrees/IMAGE-CREATIVE-ARCHITECT/p4-backend/apps/desktop/src-tauri/src/services/grade.rs:35) — `schemaVersion` được serde mặc định thành `1`, trong khi `ColorGradeDNASchema` yêu cầu trường này. Vì vậy request `grade_apply` thiếu `schemaVersion` vẫn được chấp nhận, trái với việc validate theo schema. Bỏ default và thêm kiểm tra request thiếu trường này bị từ chối.

## NÊN SỬA

- [grade.rs:367](/D:/worktrees/IMAGE-CREATIVE-ARCHITECT/p4-backend/apps/desktop/src-tauri/src/services/grade.rs:367) — Test parity dùng `zip(input, expected)` nên nếu số pixel ở hai mảng lệch nhau, phần dư bị bỏ qua mà test vẫn có thể pass. Thêm assertion số lượng phần tử bằng nhau trước khi so sánh.

## ĐẠT / điểm tốt

- Pipeline khớp thứ tự và công thức §12.3 khi đọc mã: chuyển sRGB/linear cho exposure, temperature/tint, contrast, các bước dựa trên luminance, clarity, dehaze, vibrance, saturation; chỉ clamp cuối pipeline và giữ nguyên alpha.
- `grade_apply` chạy qua `spawn_blocking`; connection DB được thả sau khi đọc asset nguồn, trước khi decode và xử lý ảnh. Giao dịch chỉ mở cho việc chèn asset và version, có cleanup file khi giao dịch lỗi.
- DNA additive fields được giữ nguyên khi persist, và có kiểm tra kiểu cho `presetId`, `id`, `enabled`, `locks.mood`.

## Đã chạy

- `git diff --check 7c63c6d HEAD` — không báo lỗi.
- Không chạy test trong vòng review này. Note của nhánh ghi nhận `cargo test`, `cargo fmt --check` và `cargo clippy --all-targets -- -D warnings` đã pass; cần chạy lại parity test sau khi sửa đường dẫn và merge P4-A.