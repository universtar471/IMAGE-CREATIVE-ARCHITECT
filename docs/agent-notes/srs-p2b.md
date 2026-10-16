# wt/srs-p2b

- Agent: codex
- Nhánh: `wt/srs-p2b`
- Không commit/push; không đọc hoặc sửa `.env`.

## Mục tiêu

Hoàn thiện SRS P2b/ADR-036: registry chi tiết kiến trúc, planner shot chi tiết, validator target, compiler section `DETAIL TARGET`, ShotIntent, UI “Khám phá chi tiết”, batch flow và i18n Anh/Việt.

## Đã xong

- Thêm `packages/domain/src/detail/` với `ArchitecturalDetailRegistry` và `planDetailShots`; chỉ lập kế hoạch từ detail đã xác minh, chọn camera nhìn được facade, tránh lặp góc và báo shortfall.
- Mở rộng `ShotIntentSchema` với `targetDetailId`/`detailShotCount`, giữ `PromptBundle.shotIntent` và Rust DTO hiện có; store desktop coi các field mới là dữ liệu có ý nghĩa khi kiểm tra rỗng.
- Thêm validator `OCCLUDED_TARGET`, phân biệt target không tồn tại (BLOCK) và camera không nhìn thấy facade (WARN/reselect), kèm test balcony tầng hai mặt trước.
- Thêm section `DETAIL TARGET` vào compiler với `COMPILER_VERSION = "pc-1.8.0"`; giữ `VALIDATOR_VERSION = "cv-1.2.0"` và cập nhật schema JSON/Rust validation test.
- Thêm `features/detail/DetailPanel.tsx`: editor facade/tầng/vị trí/evidence/materials, danh sách detail đã xác nhận, chọn 1–10 shot, auto/manual planner, shortfall warning, read-only guard và mở batch qua conflict gate.
- Nối planned camera selection vào `BatchDialog`/batch plan, thêm i18n tiếng Việt đầy đủ dấu và tiếng Anh, cùng test domain/UI/nav liên quan.

## Hình dạng đã chọn

- Planner trả `{ shots, shortfall, warnings }`; mỗi shot có `{ detailId, cameraSuggestion, angleIndex, shotType }`.
- `shotType` dùng đúng union `approach | architectural_detail | material_closeup`; detail có material thì ưu tiên `material_closeup`.
- Registry là writer duy nhất của `dna.architecturalDetails`; các field P0 cũ được giữ tương thích khi parse DNA.
- `ShotIntent` là snapshot per-shot, không ghi ngược vào DNA; target được compiler phát thành section `DETAIL TARGET` chỉ khi có `targetDetailId`.

## Còn nợ / giới hạn

- Batch flow hiện truyền một `ShotIntent` snapshot cho cả batch; planned shots vẫn chọn đúng các camera đã lập kế hoạch nhưng chưa mang một `targetDetailId` riêng cho từng item nếu nhiều detail dùng cùng camera. Đây là debt để tách `plannedShots` thành per-item intent trong một phase sau.
- Nút lập kế hoạch hiển thị plan và mở batch; việc queue thực tế vẫn do `BatchDialog`/conflict gate hiện hữu đảm nhiệm.

## Lệnh test

- `cmd /c npm run verify` — typecheck/lint, Vitest `69` files / `785` tests pass, Rust `288` pass / `6` ignored.
- `cmd /c npx prettier --check .` — pass.
- `cargo fmt --check` trong `apps/desktop/src-tauri` — pass.
- `cargo clippy --offline --all-targets -- -D warnings` trong `apps/desktop/src-tauri` — pass.
- `cargo test --offline` trong `apps/desktop/src-tauri` — `288` pass / `6` ignored.

## Cạm bẫy

- Không dùng `resolveVisibility` trực tiếp với detail; planner phải lấy facade từ `detail.facade` hoặc `detail.location.facade` rồi resolve adjacency.
- `verifiedLocation`/`existence` có thể là boolean hoặc evidence verdict; chỉ detail đã xác minh mới được planner chọn.
- Không thay đổi `COMPILER_VERSION`, `VALIDATOR_VERSION` ngoài các giá trị đã chốt; không đụng `camera/intent.ts`, VisualIntentSelector hoặc các module P2 khác.
- Cargo phải chạy `--offline`; `CARGO_TARGET_DIR` ở ổ `F:` được giữ nguyên.

