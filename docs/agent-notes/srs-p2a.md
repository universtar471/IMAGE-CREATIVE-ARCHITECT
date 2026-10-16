# wt/srs-p2a — SRS P2a: visual camera intent (ADR-036)

## Mục tiêu và phần đã hoàn thành

- Bổ sung visual camera intent cho domain, validator, prompt bundle và Rust DTO.
- Giữ nguyên `COMPILER_VERSION = "pc-1.8.0"` và `VALIDATOR_VERSION = "cv-1.2.0"`.
- Thêm `VisualIntentSelector` dùng chung cho Camera và Generate, gồm ba mức Dễ dùng / Tùy chỉnh / Chuyên gia; intent được giữ trong `workspace.shotIntent`, không ghi vào DNA.
- Wire intent vào generate snapshot, preview, store theo project và chế độ read-only; thêm i18n tiếng Anh và tiếng Việt đầy đủ dấu.
- Hợp nhất conflict trong `packages/domain/src/prompt/compiler.ts` và `packages/domain/src/validation/validateShot.ts`, giữ hành vi của cả P2a và P2d.

## Shape/schema đã chọn

- `visualIntent.view`: `front | street_oblique | pedestrian | overview | approach | detail | aerial`.
- `visualIntent.purpose`: `landscape | portrait | square`.
- Slider tùy chọn `distance`, `height`, `focus`, mỗi giá trị `0..100`.
- `availableIntents(dna, spaceZone?)` loại `aerial` cho nội thất và loại side-reveal cho attached townhouse dựa trên `resolveSiteAdjacency`.
- `resolveVisualIntent` chỉ gợi ý `viewType`, `presetId`, aspect ratio và lens bucket; không tự sinh `azimuthDeg`, `distanceM` hoặc `heightM`.
- `PromptBundle.shotIntent` và Rust DTO dùng field optional; intent rỗng không làm thay đổi output compiler cũ ngoài version đã được quyết định trước đó.

## Debt/limitation

- Chưa kiểm tra trực quan trên app đang chạy; UI được bao phủ bằng jsdom tests.
- Intent hiện được giữ trong workspace store theo session, chưa persist qua lần mở app mới.
- `CameraDirector` vẫn là đường Expert; selector không thay thế các trường camera đo đạc.
- `resolveVisualIntent` chưa biến slider thành số đo thực tế; việc đó vẫn thuộc camera facts/CameraDirector.

## Trap/conflict

- `ShotIntentSchema` nằm ở `packages/domain/src/validation/shotIntent.ts`; `schemas/prompt.ts` phải import từ đây để tránh vòng import với `validateShot.ts`.
- Store chỉ coi intent là rỗng khi tất cả field intent mới và các field P2d đều unset; không được xóa visual intent hợp lệ khi thiếu scene object/detail.
- `availableIntents` phải dùng adjacency đã resolve để không quảng bá hai mặt tiền cho townhouse liền kề.
- Không đọc `.env`, không gọi API trả phí; cargo chạy offline.
- Git vẫn có trạng thái `UU` ở hai file đã giải conflict vì lead chưa stage; nội dung file không còn marker conflict và không được tự `git add`.

## Test commands và kết quả

- `npm.cmd run typecheck` — pass.
- `npm.cmd run lint` — pass.
- `npm.cmd test` — 70 test files, 784 tests pass.
- `npx.cmd vitest run ...` — các test camera intent, compiler, i18n và UI liên quan pass.
- `CARGO_NET_OFFLINE=true npm.cmd run verify` — pass.
- `npx.cmd prettier --check .` — pass.
- `apps/desktop/src-tauri`: `cargo fmt --check` — pass.
- `apps/desktop/src-tauri`: `cargo clippy --offline --all-targets -- -D warnings` — pass.
- `apps/desktop/src-tauri`: `cargo test --offline` — 287 pass, 6 ignored, 0 fail.

