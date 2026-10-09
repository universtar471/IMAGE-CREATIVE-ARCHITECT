# Review p4-integrate — vòng 2

## Kết luận: PHẢI SỬA

### PHẢI SỬA

- `apps/desktop/src-tauri/src/services/grade.rs:57` — `look: Option<String>` cho phép Rust deserialize `"look": null` thành `None`. `ColorGradeDNASchema` chỉ cho phép bỏ trường này hoặc truyền chuỗi, nên `grade_apply` chấp nhận payload mà schema từ nguồn chuẩn từ chối; khi lưu operation, giá trị `null` còn bị bỏ đi. Thêm kiểm tra từ chối `null` và test gửi `look: null` để test thất bại nếu bỏ kiểm tra.

### Finding vòng 1

| Review | Finding | Trạng thái |
|---|---|---|
| Domain | Ảnh output được chọn làm nguồn variation vẫn mang role `regular_image` | **ĐÃ SỬA.** `buildMoodVariationItems` gán role `master_architecture`; test kiểm tra chỉ dẫn prompt và role. |
| Domain | Schema preset mood loại `lighting` và `weather` lồng trong `values` | **ĐÃ SỬA.** Schema nhận hai section; test nạp preset qua `KnowledgeRegistry`, kiểm tra prompt, adopt và locks. |
| Domain | `applyGradeToImageData` sửa buffer đầu vào mặc định | **ĐÃ SỬA.** Mặc định clone, hỗ trợ buffer đích tường minh; test xác nhận source không đổi và đường in-place hoạt động. |
| Domain | Cấp phát tuple RGB cho từng pixel | **ĐÃ SỬA phần code; test chưa chứng minh tối ưu.** Buffer xử lý tái sử dụng scratch tuple. Test TypeScript hiện có xác nhận kết quả, không phát hiện hồi quy cấp phát theo pixel. |
| Backend | Parity test không đọc vector chung của domain | **ĐÃ SỬA.** Test đọc `packages/domain/test-vectors/grade.json` trực tiếp và thất bại nếu file thiếu. |
| Backend | Thiếu `schemaVersion` vẫn được chấp nhận | **ĐÃ SỬA.** Rust bỏ default; test deserialize request thiếu trường này và yêu cầu lỗi. |
| Backend | `zip` bỏ qua phần dư khi độ dài input/output lệch | **ĐÃ SỬA.** Parity test assert hai độ dài bằng nhau trước khi so pixel. |
| UI | Contact Sheet thiếu thao tác adopt mood | **ĐÃ SỬA phần UI; test chưa kiểm tra thao tác trên component.** `MoodGroup` có nút Adopt và tìm preset theo label/ID. Test hiện gọi helper và kiểm tra resolver riêng, nên vẫn pass nếu nút hoặc wiring bị bỏ. |
| UI | Mood adopt chỉ ghi section mood | **ĐÃ SỬA phần UI; test chưa kiểm tra wiring vào store.** Handler ghi mọi section trả về từ helper. Test xác nhận helper trả các section nhưng không xác nhận component gọi `editDna` cho từng section. |
| UI | Selector dùng nhãn thay vì ID preset | **ĐÃ SỬA.** Select dùng `presetId`; adopt lưu ID và nhãn. Test xác nhận ID dùng làm giá trị select. |
| UI | Weather picker không merge `values` dạng partial trực tiếp | **ĐÃ SỬA phần code; test chưa kiểm tra handler chọn preset.** Handler merge `weatherPresetValues`, helper hỗ trợ cả shape trực tiếp và nested legacy. Test chỉ gọi helper, không xác nhận wiring trong picker. |
| UI | Kết quả grade hoàn tất sau khi chuyển project vẫn bị chọn | **ĐÃ SỬA.** Store chỉ chọn asset nếu project hiện tại còn là project ban đầu. Test trì hoãn `grade_apply`, chuyển project rồi xác nhận asset của project mới vẫn được chọn. |

### Kiểm tra tích hợp

- UI grade re-export từ `@arch/domain`; không còn stand-in grade math hay `TODO(p4-domain)` trong mã nguồn.
- TypeScript và Rust đều tính exposure bằng `2^(exposure/100)` cho slider `-100..100`. Rust parity test đọc vector domain trực tiếp và so sánh sai số từng kênh tối đa ±1.
- Mood adopt và `compileWithOverrides` bỏ qua section bị khóa; Contact Sheet nhóm variation theo job label rồi phân giải preset trong pack hiện tại.
- Grade tạo asset/version mới; test backend so sánh bytes của source trước và sau để kiểm ADR-004.
- Không thấy secret mới hoặc đường đưa key vào UI/logs. Các chuỗi lighting và mood/grade có mặt ở cả `en` và `vi`; test đối chiếu key của hai nhóm.
- Store có guard project ID trong `adoptAssets` và guard trước khi chọn kết quả grade sau khi đổi project.

Không chạy Vitest hoặc Cargo theo giới hạn sandbox; các test được đánh giá qua mã nguồn và nội dung test. Reviewer này chưa xác minh kết quả `npm run verify`.
## Lead verify (Claude, sau khi gộp fix)

- `npm run verify`: **ĐỎ** — `apps/desktop/tests/p4-ui.test.ts:109` mong `sections.mood.atmosphere = "cinematic"` nhưng nhận `undefined`. Nguyên nhân: test/adapter UI giả định preset mood dạng lồng `values.mood`, còn domain (`adoptMoodPreset`, batch.ts:93) và API §12.2 dùng dạng phẳng: `values` = partial của mood, kèm `lighting`/`weather` tuỳ chọn. Hai nhánh fix chạy song song nên không thấy nhau. PHẢI SỬA: UI theo đúng dạng phẳng của domain.
- `prettier --check`, `cargo fmt --check`: đạt.

---

# Review p4-integrate — vòng 3

## Kết luận: ĐẠT

### PHẢI SỬA

Không có.

### NÊN SỬA

Không có.

### Đối chiếu các mục vòng 2

- **Từ chối `look: null`: ĐÃ SỬA.** `grade.rs:63` dùng deserializer yêu cầu chuỗi khi trường `look` hiện diện; trường bị thiếu vẫn dùng giá trị mặc định. Test tại `grade.rs:337` gửi `look: null` và yêu cầu deserialize thất bại.
- **Preset mood dùng shape phẳng trong UI: ĐÃ SỬA.** `MoodGradePanel.tsx:110` nhận diện các partial `lighting` và `weather`, rồi phân loại những key còn lại là mood. `weatherPresetValues` trả trực tiếp `preset.values` (`MoodGradePanel.tsx:44`). Kiểm tra `git grep` không thấy giả định `values.mood` hoặc `values.weather` còn lại trong các vùng UI, mock và domain được yêu cầu rà. Shape khớp với schema ở `packages/domain/src/knowledge/pack.ts:131` và cách domain tách các section trong `packages/domain/src/generation/batch.ts:71,95`.
- **Component tests kiểm tra thao tác thật: ĐẠT.** Các test tại `p4-ui.test.ts:161` trở đi đổi lựa chọn preset trong Mood / Grade và Weather picker, rồi kiểm tra `draftDna`; test Contact Sheet bấm “Adopt this mood” và kiểm tra cả mood, lighting, weather. Nếu bỏ handler hoặc wiring cập nhật store, các assertion này sẽ thất bại.
- **Locks được tôn trọng: ĐẠT.** Domain chỉ ghi các section chưa khóa (`batch.ts:96–108`); test component tại `p4-ui.test.ts:176` khóa lighting và weather, rồi xác nhận hai section đó giữ nguyên sau khi adopt. Test helper cũng kiểm tra lighting bị khóa không đổi (`p4-ui.test.ts:83`).

### Rà soát hồi quy tích hợp

- **ADR-004:** Không thấy hồi quy; test Rust tại `grade.rs:354` xác nhận tạo asset/version mới và bytes của source không đổi.
- **i18n en/vi:** Các key Mood / Grade có mặt trong cả hai locale (`en.ts:923`, `vi.ts:929`); test parity đối chiếu keys ở `p4-ui.test.ts:367`.
- **Thay đổi vòng 3:** Diff chỉ thêm kiểm tra `look: null`, cập nhật xử lý preset mood trong panel, bổ sung component tests và ghi chú bàn giao. Không thấy vấn đề mới trong các mục đã yêu cầu rà.

Không chạy test theo yêu cầu; kết quả `npm run verify` do lead chạy riêng.

## Lead verify (Claude, 671ac69)

- `npm run verify`: xanh — 321 Vitest; 227 Rust pass, 5 ignored.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `npx prettier --check .`: đạt.
