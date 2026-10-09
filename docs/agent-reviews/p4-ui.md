# Review p4-ui — vòng 1

## Kết luận: PHẢI SỬA

## PHẢI SỬA (chặn merge)

- [ContactSheet.tsx](/D:/worktrees/IMAGE-CREATIVE-ARCHITECT/p4-ui/apps/desktop/src/features/camera/ContactSheet.tsx:81): Contact Sheet nhóm kết quả variation theo preset, nhưng mỗi kết quả chỉ có nút mở trên canvas; không có thao tác “Adopt this mood”. Vì vậy người dùng không thể áp preset của kết quả đã chọn vào DNA như brief yêu cầu. Thêm thao tác adopt cho từng nhóm/kết quả; thao tác cần gọi `adoptMoodPreset` với preset tương ứng rồi để DNA autosave.

- [MoodGradePanel.tsx](/D:/worktrees/IMAGE-CREATIVE-ARCHITECT/p4-ui/apps/desktop/src/features/mood/MoodGradePanel.tsx:140): `adopt` gọi helper có thể trả về thay đổi ở lighting và weather, nhưng chỉ ghi `... .mood` vào DNA. Chẳng hạn chọn preset fallback `Blue hour` chỉ đổi mood; `lighting.timeOfDay = blue_hour` bị bỏ. Ghi lại các section đã mở khóa từ kết quả helper, hoặc giới hạn preset của picker này đúng là chỉ có mood.

- [MoodGradePanel.tsx](/D:/worktrees/IMAGE-CREATIVE-ARCHITECT/p4-ui/apps/desktop/src/features/mood/MoodGradePanel.tsx:179): Select hiển thị `mood.preset`, trong khi options dùng `p.id`; contract quy định `presetId` là ID ổn định còn `preset` giữ nhãn. Sau khi chọn preset đặt `preset` thành nhãn, giá trị select không khớp option ID nên control hiện trạng thái trống. Dùng `mood.presetId` làm value và lưu cả ID lẫn nhãn khi áp preset.

- [MoodGradePanel.tsx](/D:/worktrees/IMAGE-CREATIVE-ARCHITECT/p4-ui/apps/desktop/src/features/mood/MoodGradePanel.tsx:235): Contract §12.2 định nghĩa `values` của weather preset là partial trực tiếp của section, nhưng picker này chỉ merge `p.values.weather` hoặc `p.weather`. Với pack hợp lệ dạng `{ values: { sky, haze } }`, chọn preset chỉ ghi `presetId` và nhãn; các trường thời tiết không đổi. Merge `p.values` trực tiếp (và hỗ trợ dạng lồng nhau nếu cần tương thích).

## NÊN SỬA

- [store.ts](/D:/worktrees/IMAGE-CREATIVE-ARCHITECT/p4-ui/apps/desktop/src/app/store.ts:788): Nếu người dùng mở Apply grade ở project A rồi chuyển sang B trước khi lệnh hoàn tất, response vẫn gọi `selectAsset(asset.id)` vô điều kiện. `adoptAssets` có bảo vệ project, còn `selectAsset` thì không; kết quả là asset của A bị chọn trong workspace B và canvas có thể rơi vào trạng thái không có ảnh. Trước khi chọn asset, kiểm tra workspace hiện tại vẫn là project A.

## ĐẠT / điểm tốt

- Grade pipeline trong [grade.ts](/D:/worktrees/IMAGE-CREATIVE-ARCHITECT/p4-ui/apps/desktop/src/lib/grade.ts:115) khớp thứ tự, công thức, đường cong sRGB, clamp và làm tròn của §12.3; alpha được giữ nguyên khi xử lý ImageData.
- Variation builder giữ source làm reference đầu tiên và bỏ override ở các section bị khóa.
- Có bổ sung chuỗi en/vi và kiểm tra parity key; mock `grade_apply` tạo asset/version mới, giữ nguyên source.

## Đã chạy

- Đã đọc `git diff 7c63c6d HEAD`, brief, phase plan, ADR-019..021 và API contract §12; kiểm tra các call site liên quan bằng tìm kiếm mã nguồn.
- Không chạy test trong lượt review này.