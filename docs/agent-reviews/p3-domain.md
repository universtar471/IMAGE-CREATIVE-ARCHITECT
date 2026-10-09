# Review p3-domain — vòng 1

## Kết luận: PHẢI SỬA

## PHẢI SỬA (chặn merge)

- [packages/domain/src/generation/batch.ts:103](/D:/IMAGE-CREATIVE-ARCHITECT/packages/domain/src/generation/batch.ts:103): `buildItem` cắt danh sách reference theo `maxReferenceImages`, nên camera có master và anchor nhưng model chỉ nhận một ảnh sẽ bị bỏ anchor. Ví dụ model có `maxReferenceImages: 1`, camera đã có anchor: batch gửi master nhưng thiếu anchor, trái yêu cầu production giữ cả hai. Hãy chặn tạo batch khi giới hạn không đủ chứa các reference bắt buộc và báo lỗi để UI yêu cầu chọn model khác; đừng âm thầm tạo item thiếu anchor.

## NÊN SỬA

- [packages/domain/src/schemas/future.ts:30](/D:/IMAGE-CREATIVE-ARCHITECT/packages/domain/src/schemas/future.ts:30): regex `CAM_` chấp nhận mọi ký tự đầu thuộc alphabet Crockford, kể cả `8`–`Z`; ULID 26 ký tự hợp lệ chỉ có thể bắt đầu bằng `0`–`7`. Vì vậy các ID như `CAM_Z000000000000000000000000` được schema chấp nhận dù không phải ULID chuẩn. Giới hạn ký tự đầu thành `[0-7]` để `validateProjectDNA` và JSON Schema xuất ra cùng từ chối ID sai.

## ĐẠT / điểm tốt

- Compiler đưa camera section sau context; khi không có context, section xuất hiện sau section trước đó. Lookup camera theo `cameraId` và `sortReferences` giữ kết quả độc lập với thứ tự camera/reference đầu vào.
- Anchor reference được đánh số ngay sau master và có hướng dẫn riêng; master vẫn là nguồn quyết định kiến trúc.
- Quy ước từ ngữ azimuth khớp định nghĩa mã nguồn: `0` nhìn thẳng mặt tiền, góc dương quay theo chiều kim đồng hồ nhìn từ trên xuống; `+45` được diễn đạt là front-left.
- ULID generator mã hóa timestamp và phần ngẫu nhiên theo Crockford base32, dùng `crypto.getRandomValues` và tăng phần ngẫu nhiên khi cùng hoặc lùi millisecond.
- Các pack có test kiểm tra số lượng preset, anchor đề xuất, giá trị chụp thực tế và nhóm view bắt buộc; `KnowledgeRegistry` phân giải preset theo pack subtype, type default rồi custom fallback.
- `paramsForCamera` chỉ ghi đè aspect ratio khi model có cung cấp tỷ lệ đó.

## Đã chạy

- `npm.cmd run typecheck -w @arch/domain` — đạt.
- `npx vitest run --project domain` — không chạy được: Vitest cần ghi file tạm trong `node_modules/.vite-temp`, nhưng sandbox chỉ đọc và trả `EPERM`.