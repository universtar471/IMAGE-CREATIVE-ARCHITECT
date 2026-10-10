# wt/ux-guide

- Agent: Codex
- Tách từ: `main`
- Tạo lúc: 2026-10-10 17:25

## Mục tiêu

Cải thiện hướng dẫn workflow cho người dùng không chuyên: bước tiếp theo rõ ràng, xác nhận chi phí trước mọi thao tác AI trả phí, tạo lại riêng một Anchor và giải thích điều kiện khóa.

## Đã xong

- Thêm hàm thuần `nextStep(workspace, workflowView)` và thanh bước tiếp theo trong panel thuộc tính; Overview dùng CTA lớn, module đích dùng dòng gợi ý, Export không hiển thị.
- Thêm `useSpendConfirm()` dùng chung cho Generate Hero/variation, Tạo lại, Anchor/production batch, mood variation, nâng cấp đơn/batch, QC vision và repair. Provider `local_*` được bỏ qua; ngưỡng mặc định 2.000đ chỉ có hiệu lực sau khi người dùng chọn lưu, được lưu an toàn trong `localStorage` và có nút đặt lại.
- Batch Anchor có checklist camera, chọn tất cả mặc định. Contact Sheet có “Tạo lại góc này”; request chỉ có đúng một camera và giữ provider/model/prompt/reference/params của generation nguồn, không thay Anchor đã duyệt.
- Thêm explainer “Vì sao đang khóa?” cho mọi step id, kèm nút đi đến bước chặn; generation-blocked UI dùng cùng explainer.
- Bổ sung chuỗi Việt/Anh, CSS và test cho thứ tự next-step, hiển thị bar, xác nhận chi phí, ngưỡng nhớ, hủy submit, camera untick, rerun một Anchor, explainer và i18n/diacritics.

## Còn nợ

Không còn hạng mục trong phạm vi task.

## Lệnh test

- `npm.cmd run verify` — xanh: 36 file / 439 test TypeScript; 255 test Rust qua, 6 live paid tests ignored.
- `npx.cmd prettier --check .` — xanh.

## Cạm bẫy đã gặp

- PowerShell chặn `npm.ps1`; dùng `npm.cmd` / `npx.cmd`.
- Phải nhận diện miễn phí bằng `providerId` bắt đầu với `local_`, không dùng nhãn hiển thị.
- Caller cũ của `planBatch` truyền danh sách camera rỗng để nói “tất cả”; dialog mới dùng cờ `cameraSelectionExplicit` để phân biệt với thao tác bỏ chọn hết.
- Selector Zustand không được tạo mảng fallback mới mỗi render; dùng hằng `EMPTY_PROVIDERS` để tránh vòng render vô hạn trong test.
