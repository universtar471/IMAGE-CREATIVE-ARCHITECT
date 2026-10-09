# Review p4-preview-fix — vòng 1

## Kết luận: PHẢI SỬA

- **[PHẢI SỬA]** [bridge.ts](/D:/worktrees/IMAGE-CREATIVE-ARCHITECT/p4-preview-fix/apps/desktop/src/lib/bridge.ts:354): `assetPreview` không xử lý phản hồi dạng `number[]`. `ArrayBuffer.isView(raw)` chỉ nhận các typed array như `Uint8Array`; với `number[]`, hàm rơi xuống `BridgeError` ở dòng 360. `GradeCanvas` bắt lỗi này và hiện thông báo không tải được preview, nên đường IPC trả byte dưới dạng mảng số vẫn hỏng. Hãy chuyển mảng byte hợp lệ thành `Uint8Array`/`Blob` và thêm test cho cả `ArrayBuffer` lẫn `number[]`.

Các phần còn lại đã đối chiếu với brief: Rust kiểm tra project ownership và trạng thái ready, clamp `maxEdge`, không upscale, nhả DB lock trước khi đọc/giải mã ảnh và không sửa file nguồn. `GradeCanvas` không còn dùng `fileUrl` để đọc pixel, chỉ tải một lần mỗi asset, hủy tác vụ cũ, và có thông báo lỗi tiếng Việt/Anh. Test UI mới kiểm tra tải preview, regrade và lỗi tải; tuy nhiên chưa kiểm tra hai dạng phản hồi IPC nêu trên.

Không chạy test theo yêu cầu.
## Lead verify (Claude, e46b66f)

- `npm run verify` xanh: 323 Vitest, 230 Rust; fmt, clippy, prettier sạch.

---

# Review p4-preview-fix — vòng 2

## Kết luận: ĐẠT

- **[ĐẠT]** [apps/desktop/src/lib/bridge.ts:360](D:/worktrees/IMAGE-CREATIVE-ARCHITECT/p4-preview-fix/apps/desktop/src/lib/bridge.ts:360) đã xử lý phản hồi `number[]`: kiểm tra từng byte là số nguyên trong `0..255`, rồi chuyển thành `Uint8Array` và `image/png` Blob. Mảng không hợp lệ bị từ chối bằng `BridgeError`.
- **[ĐẠT]** [apps/desktop/tests/bridgePreview.test.ts:7](D:/worktrees/IMAGE-CREATIVE-ARCHITECT/p4-preview-fix/apps/desktop/tests/bridgePreview.test.ts:7) có kiểm tra `ArrayBuffer`, typed array view có offset, `number[]` và các giá trị mảng không hợp lệ. Như vậy lỗi vòng 1 có test bao phủ.
- **[ĐẠT]** Diff vòng này giữ nguyên các nhánh xử lý `Blob`, `ArrayBuffer` và typed array; không thấy hồi quy trong phần thay đổi.

Không chạy test theo yêu cầu.

## Lead verify (Claude, 27006ce)

- `npm run verify` xanh: 329 Vitest, 230 Rust; prettier sạch.
