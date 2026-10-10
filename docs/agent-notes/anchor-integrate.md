# Bàn giao `wt/anchor-integrate`

## Mục tiêu

Hoàn tất tích hợp ADR-028/API §19 giữa domain, Rust, mock backend và UI; sửa các review findings; không commit.

## Đã làm

- Thay stand-in trong `apps/desktop/src/lib/siteTopology.ts` bằng barrel re-export từ `@arch/domain`; bỏ toàn bộ `TODO(anchor-domain)` trong UI. Store giờ gửi aggregate DNA đã parse bởi domain.
- Mock backend lưu DNA đã chuẩn hóa qua `validateProjectDNA`, giữ `siteTopology` qua `dna_update` → `dna_get`, và từ chối corner topology không hợp lệ.
- Sửa prompt `pc-1.5.0`: khi hai bên đều liền kề, preservation ghi `on both sides`. Bổ sung front-right vào compiler regression và snapshot so sánh toàn bộ interior bundle với pc-1.4.0 sau khi gỡ duy nhất dòng master mới và chuẩn hóa version.
- Thêm fixture DNA townhouse người dùng và kiểm tra prompt master cho front-left, front-right, aerial cùng chip UI tương ứng.
- Rust từ chối `cornerSide` không phải string, kể cả `cornerLot: false`; thêm regression test.
- Đưa topology chip ra ngoài nút chọn camera; thêm kiểm tra autosave `dna_update`, azimuth 0/missing, aerial mật độ cao, exterior bình thường, corner refinement và năm dạng tóm tắt lô.
- Tóm tắt lô phân biệt lô giữa dãy, một bên liền kề, nhà đứng riêng, lô góc và vị trí chưa rõ; cập nhật EN/VI.
- Không tìm thấy file ADR-028 riêng trong worktree; đã dùng API contract §19 cùng task/note domain và UI làm chuẩn triển khai.

## Còn nợ

- Không còn việc đã biết trong phạm vi đề bài.
- Không tạo commit và không gọi API bên ngoài.

## Kiểm tra

- `npm ci` — thành công, dùng cache trong thư mục temp do cache npm mặc định bị từ chối quyền đọc.
- `npm.cmd run verify` — thành công: typecheck, lint, 43 Vitest files / 516 tests, Rust 272 passed / 6 ignored.
- `cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml` — thành công.
- `cargo clippy --all-targets --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings` — thành công.
- `npx.cmd prettier --check .` — thành công.

## Cạm bẫy

- PowerShell chặn shim `npm.ps1`; dùng `npm.cmd`/`npx.cmd`.
- Rust `cornerSide` không phải string cần bị từ chối ngay cả khi không bật lô góc; chỉ kiểm tra enum khi đã convert sang string là không khớp Zod.
- `SiteTopologyChip` chứa nút xử lý; đặt bên trong `camera-row-main` tạo nested buttons và làm click bubble chọn camera.
