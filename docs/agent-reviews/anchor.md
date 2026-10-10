# Review — Master-consistent anchors (wt/anchor-domain, wt/anchor-ui, wt/anchor-integrate)

Reviewer: Codex (gpt-6-luna, read-only), verified by Claude. Date: 2026-10-11.
Note: HHTECH ran out of credit during integration; the integration and fix rounds were finished by default Codex (gpt-6-luna, workspace-write).

## PHẢI SỬA (đã sửa)
- Rust `dna_validation.rs`: `cornerSide` sai kiểu lọt qua khi không phải chuỗi → từ chối mọi giá trị khác `left`/`right`.
- `compiler.ts`: hai bên liền kề nhưng câu party-wall chỉ nói một bên → "on both sides".
- (Claude phát hiện khi chạy DNA thật NHA PHO) dòng aerial_block in nguyên "Image N"; chế độ oblique/aerial làm mất ống kính, khoảng cách, góc cúi → giữ số đo, chỉ thay viewpoint/composition hoặc chữ "plot". Test quét mọi pack × preset × topology.

## NÊN SỬA (đã sửa)
- Golden test thêm góc phải; interior so toàn bộ với pc-1.4.0 trừ ngoại lệ cho phép.
- Tổng quan mô tả đúng từng trường hợp lô (giữa dãy / một bên / đứng riêng / lô góc / chưa rõ).
- Nút [Liền kề] [Lô góc] tách khỏi nút chọn camera (hết nút lồng nhau).
- Test autosave, azimuth 0/thiếu, aerial mật độ cao, ngoại thất không bị ảnh hưởng.

## ĐẠT
- Verify độc lập: 518 Vitest, 272 Rust (6 live ignored), fmt/clippy/prettier sạch.
