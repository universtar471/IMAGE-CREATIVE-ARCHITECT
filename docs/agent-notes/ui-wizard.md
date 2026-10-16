# Bàn giao `wt/ui-wizard`

## Mục tiêu

Triển khai ADR-039: wizard tạo dự án rút còn hai bước, chọn chủ đề trước ("Công trình" / "Nội thất"), dữ liệu bước 2 nạp theo chủ đề, tạo dự án ngay từ bước 2. Không đổi schema, Rust, compiler, validator.

## Đã làm

- `apps/desktop/src/features/projects/NewProjectWizard.tsx`
  - Bước 1 "Cơ bản": ô tên + hai thẻ lớn (icon lucide `Building2`, `Sofa`) có mô tả một dòng. Thẻ là radio gốc trong `fieldset role="radiogroup"`, nên phím mũi tên và Space dùng được. "Tiếp" chỉ bật khi có tên và đã chọn chủ đề.
  - Bước 2 "Phân loại":
    - Công trình: thẻ radio cho đúng 8 loại `ARCHITECTURE_TYPES` (townhouse, single_storey_house, villa, urban_villa, prefab_modular, hotel, resort, custom = "Khác"). Bên dưới là select loại chi tiết (`knowledge.listSubtypes`), rồi phong cách (tùy chọn).
    - Nội thất: công năng, phòng (lọc theo `roomsForUse`), phong cách nội thất, như bước nội thất cũ.
    - Mục thu gọn "Thông số (tùy chọn)" (`SectionPanel`, `defaultOpen={false}`): số tầng, kích thước công trình, khu đất (chỉ Công trình) và bộ chọn bối cảnh (cả hai chủ đề, vì gói `interior` cũng có preset). Báo lỗi số như cũ.
    - Bảng tóm tắt DNA nhỏ (thay cho bước 4 cũ).
  - Đổi chủ đề sẽ reset mọi giá trị bước 2 về mặc định của chủ đề đó (`themeDefaults`).
  - Nút "Tạo dự án" ở bước 2; đã bỏ bước 3, 4. Lời gọi `createProject` / `createInitialDNA` / `applyStyleDefaults` giữ nguyên như wizard cũ.
- `apps/desktop/src/i18n/vi.ts`, `en.ts`: thêm `stepClassify`, `theme*`, `typeOther`, `paramsSection`, `summary`; đổi `stepBasics` thành "Cơ bản", `type` thành "Loại công trình" / "Building type"; xóa các key không còn dùng `stepArchitecture`, `stepContext`, `stepCreate`, `levels`, `sumName`, `sumFrontRear`, `sumNegative`.
- `apps/desktop/src/styles/app.css`: style cho `.card-group`, `.theme-grid`, `.radio-card`, `.choice.is-selected`, `.choice-radio` (radio ẩn, focus-visible viền thẻ), `.wizard-summary`.
- Test:
  - Mới `apps/desktop/tests/newProjectWizard.test.tsx` (7 test): bước 1 cần tên + chủ đề, thẻ chủ đề chuyển qua lại; Công trình có đúng 8 loại, không có cafe/restaurant/office/commercial, không còn bước 3; Nội thất tạo `projectType: "interior"` với phòng + phong cách đã chọn (DNA bằng đúng `createInitialDNA` + `applyStyleDefaults`); đổi chủ đề reset bước 2; tạo không mở "Thông số" thì dùng mặc định gói; điền đủ "Thông số" + preset bối cảnh thì DNA bằng đúng output của wizard cũ cho cùng đầu vào; tóm tắt hiện ở bước 2.
  - Sửa 3 test wizard trong `apps/desktop/tests/interior.test.tsx` theo luồng mới.

## Còn nợ

- Nội thất không còn chọn loại chi tiết (subtype) trong wizard; luôn là `default` (gói `interior` có thêm `living_room`). Brief không yêu cầu; có thể đổi sau ở panel DNA nếu cần.
- Chưa kiểm tra bằng mắt trong app thật/browser preview, chỉ test jsdom.
- Thẻ loại công trình chưa có icon/ảnh riêng từng loại.

## Lệnh test

- `npm run verify` — xanh: typecheck, lint, 86 test files / 1042 tests, Rust 324 passed / 0 failed / 6 ignored.
- `npx prettier --check .` — xanh.
- Nhanh: `cd apps/desktop && npx vitest run tests/newProjectWizard.test.tsx tests/interior.test.tsx`.

## Cạm bẫy

- jsdom không ẩn nội dung `<details>` đóng, nên test điền "Thông số" được mà không cần mở; test chỉ kiểm tra `details.open === false`.
- Nhãn tiếng Anh của `prefab_modular` là "Prefab / modular" (không có "house").
- Nhãn thẻ `custom` dùng `wizard.typeOther` ("Khác"), còn bảng tóm tắt vẫn dùng `labels.projectType.custom` ("Tùy chỉnh").

Chưa tạo commit theo yêu cầu.
