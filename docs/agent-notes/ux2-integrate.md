# UX2 integration fixes

Hoàn thiện bốn lỗi review trong worktree `wt/ux2-integrate` theo ADR-029.

## Đã làm

- Nút “Thêm góc máy” mở lại bước camera, chuyển về module camera và focus preset picker. Test UI kiểm tra picker được focus sau thao tác.
- Preview grade ở chế độ split giữ ảnh gốc làm nền và clip ảnh đã grade theo vị trí slider.
- Mood preview ưu tiên preset ID, sau đó dò từ khóa trong mô tả; các mood preset của toàn bộ knowledge pack được kiểm tra có palette và tone riêng trong pack.
- List view giữ checkbox chọn nhiều ảnh và nút so sánh ảnh enhance trong từng hàng.

## Kiểm tra

- `npm.cmd run verify`: đạt; typecheck, lint, 45 test files / 534 test và Rust tests (272 passed, 6 ignored).
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check`: đạt.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`: đạt.
- `node_modules/.bin/prettier.cmd --check .`: đạt.

Không gọi API trả phí và không commit.
