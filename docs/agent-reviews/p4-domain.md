# Review p4-domain — vòng 1

## Kết luận: PHẢI SỬA

## PHẢI SỬA (chặn merge)

- `packages/domain/src/generation/batch.ts:79` — Khi người dùng chọn ảnh đầu ra làm nguồn, nếu ảnh đó không phải master, builder giữ nguyên `source.role`. Với ảnh mang role `regular_image`, compiler mô tả nguồn là hình tham khảo chung, chỉ dùng để lấy cảm hứng; mô hình không được hướng dẫn coi đó là kiến trúc và bố cục cần giữ. Gán nguồn làm master/anchor theo ngữ nghĩa biến thể, kể cả khi nguồn là ảnh đầu ra, và thêm test cho trường hợp này.

- `packages/domain/src/knowledge/pack.ts:127` — `MoodPresetSchema` chỉ nhận `values` theo `MoodPartialSchema`, nên Zod loại bỏ `lighting` và `weather` lồng trong preset. Vì vậy, dù `buildMoodVariationItems` có nhánh áp dụng các section này, preset nạp từ knowledge pack không thể cung cấp chúng; biến thể thực tế chỉ đổi mood, trái với ADR-021. Mở rộng schema preset và thêm test chứng minh lighting/weather vượt qua bước nạp pack rồi được áp dụng, đồng thời kiểm tra lock tương ứng vẫn được tôn trọng.

- `packages/domain/src/grade/apply.ts:176` — `applyGradeToImageData` sửa trực tiếp mảng đầu vào, trái với yêu cầu hàm thuần. Nếu caller tái sử dụng `ImageData` gốc cho preview hoặc áp grade lần nữa, ảnh nguồn bị thay đổi hoặc grade bị cộng dồn. Trả dữ liệu đã xử lý mà không sửa đầu vào, và thêm test xác nhận mảng nguồn không đổi.

## NÊN SỬA

- `packages/domain/src/grade/apply.ts:181` — Vòng lặp tạo tuple RGB và tuple kết quả cho từng pixel. Với ảnh độ phân giải cao, việc cấp phát hàng triệu mảng nhỏ gây áp lực GC. Dùng đường xử lý scalar hoặc buffer đích để giảm cấp phát.

## ĐẠT / điểm tốt

- Đã đối chiếu pipeline grade với §12.3: thứ tự bước, công thức, clamp cuối, đường cong sRGB và làm tròn khớp hợp đồng; chưa thấy sai lệch math.
- Compiler thêm các section theo thứ tự ổn định, cập nhật version, và thêm preservation lines cho lighting/weather/mood locks.
- Schema giữ các trường mới theo hướng bổ sung; ID artificial light có helper tạo đúng tiền tố `LGT_`.
- Có script sinh grade vectors và test identity, nhưng test suite chưa chạy được trong môi trường read-only để xác nhận toàn bộ nhánh.

## Đã chạy

- `git diff 7c63c6d HEAD` và đọc brief, note, PHASE_04, §12 cùng ADR-019–021.
- `npm.cmd test -- --run packages/domain/tests` — không khởi chạy được: Vitest cần ghi file tạm trong `node_modules/.vite-temp`, nhưng bị `EPERM` do quyền read-only.
- `git status --short` — không có thay đổi trong worktree.