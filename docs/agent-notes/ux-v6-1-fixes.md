# wt/ux-v6-1-fixes

- Agent: codex
- Tach tu: origin/claude/ux-v6-1
- Tao luc: 2026-10-20 23:15

## Muc tieu

Sửa các khoảng trống V6.1 sau audit theo yêu cầu trực tiếp của người dùng, cập nhật PR #5 và merge khi kiểm tra đạt.

## Da xong

- Panel theo node, giữ video draft, fullscreen thật, dừng âm thanh nền.
- Sửa video mất URL khi React StrictMode replay effects.
- Font offline kèm license; workflow Verify; browser acceptance test có thể chạy lại.
- Chi tiết: `docs/design/v6-1/QA_R2.md`.

## Con no

QA thủ công trên cửa sổ Tauri/WebView2, scale Windows thật, clip provider qua asset protocol.
Không lấy Typography V2 chưa commit từ worktree khác. Các tính năng V6.2–V6.5 tiếp tục nằm ngoài phạm vi.

## Lenh test

`npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test -- --maxWorkers=4`,
`npm run build -w @arch/desktop`, `npm run test:ui`,
`cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml`,
`cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check`,
`cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`.

## Cam bay da gap

- ViewerVideo cleanup xoá src; StrictMode chạy lại effect trên cùng element nên phải khôi phục src ở setup.
- Browser QA phải có generation lineage để clip/reference xuất hiện trong Node Canvas.
- Session store được reset khi mở project để video draft không rò sang project khác.
- Không chạy live provider test. Artifact/scratch mặc định ở temp, không nằm trong repo.

