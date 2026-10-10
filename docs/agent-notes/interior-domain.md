# wt/interior-domain

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-10 20:16

## Muc tieu

Triển khai Interior DNA domain + backend theo ADR-027 và API contract mục 18, giữ tương thích dự án cũ và không gọi API trả phí.

## Da xong

- Thêm catalog Interior DNA đầy đủ: building use, room cascade, style/default, palette/swatches, 13 preset đủ 7 surface slot, surface materials/swatches, furniture và camera preset.
- Thêm `InteriorDNASchema`, refinement room/use và enum riêng từng surface slot; gắn `interior` tùy chọn vào `ProjectDNASchema` và tái sinh JSON Schema.
- Thêm toàn bộ helper mục 18.3, gồm legacy proposal không mutation và prompt lines; export qua `@arch/domain`.
- Nâng compiler lên `pc-1.4.0`: form/style/material/furnishing/lighting/camera nội thất, bỏ slot trống, giữ nguyên nhánh cũ khi không có `dna.interior`.
- Mirror room/use cascade trong Rust tại lỗi `interior.roomId`, kèm test hợp lệ, sai cascade và DNA cũ không đổi.
- Thêm test catalog integrity, cascade, style defaults, legacy matching, schema refinements và compiler Japandi living-room/camera fallback.

## Con no

- Không còn việc trong phạm vi task.

## Lenh test

- `npm.cmd run verify` — PASS: 40 test files, 480 TypeScript tests; 267 Rust tests pass, 6 live-provider tests ignored.
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check` — PASS.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings` — PASS.
- `npx.cmd prettier --check .` — PASS.
- `npm.cmd run schema:export` — launcher `tsx` bị lỗi sandbox `uv_os_get_passwd returned ENOMEM`; đã bundle chính script export bằng esbuild trong `%TEMP%`, chạy bằng Node và test JSON Schema drift PASS.

## Cam bay da gap

- PowerShell chặn `npm.ps1`; dùng `npm.cmd` / `npx.cmd`.
- Không gọi API/network. Sáu live-provider test bị ignore theo thiết kế. Không tạo commit.

