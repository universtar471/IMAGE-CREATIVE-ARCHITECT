---
title: "IMAGE-CREATIVE-ARCHITECT — Đặc tả sản phẩm & kỹ thuật tổng hợp"
subtitle: "Building Space Catalog V3 → Camera / Context / Effects / Objects V4 → Render & Upscale V5 → Diagram V6 → Publishing V7.2"
author: "Tài liệu tổng hợp yêu cầu và thiết kế kỹ thuật"
date: "15/10/2026"
lang: vi-VN
---

**Phiên bản tài liệu:** SRS 1.0 — 15/10/2026  
**Phạm vi:** Các chức năng trao đổi từ Space Catalog V3 đến Publishing Studio V7.2.  
**Dự án tham chiếu:** ZIP `IMAGE-CREATIVE-ARCHITECT-main.zip` do người dùng cung cấp và gói `Building_Space_Catalog_V3.zip`.  
**Trạng thái:** Đặc tả yêu cầu và thiết kế tích hợp; **không phải bản vá mã nguồn đã triển khai**.

> **Mục tiêu sản phẩm:** Người dùng không cần chuyên môn về máy ảnh, prompt hoặc dàn trang vẫn có thể tạo chuỗi ảnh kiến trúc nhất quán: chọn công trình và không gian → chụp góc phù hợp → bổ sung hiệu ứng/vật thể hợp lệ → nâng cấp render và 2K/4K → tạo diagram → xuất portfolio/catalog/concept/tạp chí đúng số trang đã yêu cầu.

## Lộ trình đọc tài liệu

| Mục | Nội dung chính |
|---|---|
| **§1–§3** | Quyết định kỹ thuật, hiện trạng repository, kiến trúc thống nhất và dữ liệu có bằng chứng. |
| **§4–§7** | Danh mục công trình/không gian, camera/nhà liền kề, góc chi tiết, hiệu ứng và vật thể. |
| **§8–§9** | Nâng cấp render, bảo toàn chi tiết, upscale 2K/4K, local/API/ComfyUI, hàng loạt. |
| **§10–§11** | Diagram, video concept, Portfolio/Catalog/Concept/Magazine và đúng số trang. |
| **§12–§16** | Prompt compiler, UI, schema mẫu, danh sách file sửa/thêm, bộ nghiệm thu AC-01…AC-22. |
| **§17–§19 & Phụ lục** | Roadmap, rủi ro, Definition of Done, prompt templates và ví dụ end-to-end. |

---

# 1. Tóm tắt quyết định bắt buộc

1. **Một nguồn sự thật về thiết kế:** Project DNA + Site DNA + Space/Detail Registry + các ảnh/bản vẽ được duyệt. Những lựa chọn camera, hiệu ứng, vật thể và hậu kỳ không được thay đổi dữ liệu này chỉ để làm ảnh đẹp hơn.
2. **Một đối tượng không gian đích cho mỗi yêu cầu tạo ảnh (`targetSpaceId`)**; không kết hợp nhầm preset phòng khách, sân sau, ban công hay phòng ngủ trong một ảnh.
3. **Camera thay đổi vị trí quan sát, không thay đổi hiện trạng khu đất.** Góc chéo của nhà phố liền kề không được tự xóa nhà bên cạnh để lộ mặt hông.
4. **Preset phân lớp, không ghép chuỗi vô điều kiện:** Building → Space → Site → Camera → Detail → Objects → Lighting/Weather → Effects → Preservation → Provider-specific adapter.
5. **Không tự thêm cấu kiện, công năng hoặc chi tiết chưa được xác nhận.** `required` trong catalog là quy tắc chức năng có điều kiện, không phải lệnh tạo thêm cửa, hồ bơi, sân vườn hoặc đồ nội thất ngoài thiết kế.
6. **Ảnh nâng cấp phải có cơ chế bảo toàn thật:** chỉnh ảnh không tạo sinh mặc định; vùng khóa được kiểm soát bằng mask/composite và QC, không chỉ câu “do not change architecture”.
7. **Trang xuất bản là ràng buộc cứng:** người dùng chọn 1 trang với 10 ảnh thì hệ thống xuất đúng 1 trang và đủ 10 ảnh khi bật `include_all`. Nếu quá chật thì cảnh báo, không tăng số trang âm thầm.
8. **Dữ liệu đã xác minh và dữ liệu AI suy luận phải được phân biệt.** Không tự công bố kích thước, bố cục không nhìn thấy, hướng nắng, thương hiệu vật liệu hoặc công năng như thông tin có thật.
9. **Các module chia sẻ một Unified Constraint/Conflict Engine**, cùng mã lỗi, cùng hệ thống cảnh báo/đồng ý ngoại lệ, cùng snapshot để tái tạo kết quả.
10. **Giữ khả năng mở dự án cũ:** mở rộng schema theo trường tùy chọn, có migration/version của extension; không thay thế Knowledge Registry và workflow hiện hữu theo kiểu phá tương thích.

# 2. Hiện trạng mã nguồn và ranh giới triển khai

## 2.1. Nền tảng đã tồn tại

| Phần hiện có | Bằng chứng trong repository | Đánh giá |
|---|---|---|
| Dữ liệu công trình/khung cảnh/camera | `packages/domain/src/schemas/projectDna.ts`, `schemas/future.ts` | Có Project DNA `schemaVersion: 1`, camera và lighting; thiếu site adjacency/space instances chuyên sâu. |
| Trình biên dịch prompt | `packages/domain/src/prompt/compiler.ts` | `COMPILER_VERSION = pc-1.3.0`; thứ tự section cố định; chưa có scope theo không gian, visibility hay scene objects. |
| Knowledge Packs | `packages/domain/src/knowledge/{pack,registry}.ts` | Registry theo project type/subtype; preset camera, ánh sáng, thời tiết, mood. |
| Tải Knowledge Pack | `apps/desktop/src/lib/knowledge.ts` | Chỉ glob `knowledge/*/*/pack.json`; catalog sâu hơn cần loader riêng. |
| Camera chuyên môn | `features/camera/{CameraPanel,CameraDirector}.tsx`; `camera/describe.ts` | Có chỉnh vị trí camera; mô tả góc `three-quarter` có nguy cơ bị AI hiểu thành mặt hông thoáng. |
| Nâng render | `features/enhance/{EnhancePanel,EnhanceBatchDialog}.tsx`; `generation/enhance.ts` | Có nâng một ảnh/nhiều ảnh, conservative/generative; preservation cần tăng cường. |
| Upscale cục bộ | `src-tauri/src/providers/local_upscale.rs` | Lanczos3 + unsharp, **không phải AI super-resolution**. |
| Chọn vùng và ghép ảnh | `features/regions/RegionCanvas.tsx`; `src-tauri/src/services/regions/mask.rs` | Có nền tảng mask/composite để tái sử dụng. |
| Tạo ảnh, asset và QC | `app/services.ts`, `features/generate`, `features/qc`, `features/assets` | Có provider/job/asset/versions để tích hợp thêm workflow. |
| Xuất bản nhiều trang | `features/workspace/modules.ts` | `export` còn `availableIn: 9`; chưa có Publishing Studio hoàn chỉnh. |

## 2.2. Gói Building Space Catalog V3 đã tạo

- Dữ liệu gói riêng có **12 building archetypes và 256 space presets**; gồm `catalog.json`, `integration/spaceSchema.ts`, `catalog.ts`, `resolver.ts`, `SpaceSelector.tsx`, test mẫu.
- Gói **chưa được chép/ghép vào repository gốc** và chưa hoàn thành typecheck, build và integration test toàn ứng dụng.
- Các prompt tiếng Anh đã được tạo theo quy tắc nhóm, nhưng một số `labelEn` là tên tiếng Việt không dấu (ví dụ dạng “phong khach rieng”), cần **hiệu đính tiếng Anh chuyên ngành** và biên soạn riêng cho không gian đặc thù.
- Cần ánh xạ archetype của catalog với `ProjectTypeSchema` hiện tại: enum chứa `townhouse`, `villa`, `interior`, `commercial` nhưng **không trùng 1:1** với tất cả archetype như `apartment`, `healthcare`, `education`, `public`, `retail`. Không mở rộng enum và đổi projectType một cách tùy tiện; trước tiên dùng `buildingArchetype` độc lập.

## 2.3. Phân loại trạng thái công việc

- **Có trong app:** Project DNA, Prompt Compiler, Camera Director, Enhance/Batch, Local Upscale, Region Mask, Asset/QC.
- **Đã có gói mẫu riêng:** Building Space Catalog V3 (256 preset), chưa merge.
- **Mới ở mức đặc tả:** Camera–Context V4.1, Detail Shots V4.2, Optical & Motion V4.3, Scene Objects V4.4, Render Enhancement V5, Upscale Router V5.1, Diagram V6, Publishing V7.2.
- **Không được hiểu:** Các nhà cung cấp API, mức phí hoặc tên model được nhắc trong trao đổi trước là cam kết hỗ trợ; cần thực hiện capability discovery và kiểm tra chính thức khi triển khai.

## 2.4. Các thư viện/định hướng trước V3 cần hợp nhất

- **Architectural Context Library V4 (gói riêng):** `Architectural_Context_Library_V4.zip` đã có `presets.json` ghi **131 context presets**, cùng `regions.json` cho các vùng khí hậu/văn hóa. Các preset này là dữ liệu bối cảnh đề xuất, không được lấn át Site DNA đã xác minh. Cần kết hợp với `Site Adjacency/Visibility Resolver` để tránh xóa nhà liền kề khi camera thay đổi. Nhãn vùng cần rà soát trước khi tuyên bố dùng cho mọi tỉnh/thành.
- **Interior Engine V2 (đã thiết kế, chưa có bản vá tích hợp):** giữ mục tiêu phân biệt không gian nhà phố, biệt thự, căn hộ; bố trí thực và khóa tường/cửa/cột/đồ nội thất. Kế hoạch cũ **120 preset** là đề xuất thiết kế; bộ Catalog V3 **256 preset** là dữ liệu thực tế đã tạo riêng, không cộng 120 và 256 thành 376 preset.
- **Vấn đề defaults cũ phải sửa:** `knowledge/interior/living_room/pack.json` hiện mặc định kích thước **5 × 6 × 3 m** và `macroContext: residential apartment`, không đúng cho mọi phòng khách; `knowledge/interior/default/pack.json` cũng thiên về căn hộ. Chuyển những giá trị này thành ví dụ có nhãn **sample/not verified**, hoặc loại khỏi dữ liệu mặc định dùng tạo prompt.
- **Ưu tiên thông tin:** khóa thiết kế/dữ liệu đo > Site DNA có bằng chứng > Context Library vùng miền > phong cách/điều kiện chụp > trang trí hoặc vật thể bổ sung. Một preset “phố nhiệt đới” không được tự thêm cây/đường/sân vườn nếu khu đất không có chỗ.

# 3. Kiến trúc thống nhất (đề xuất)

## 3.1. Các loại dữ liệu và chủ sở hữu

**Project Facts (bền vững):** loại công trình, kích thước đo được, hình khối, tường/cửa/cột, vật liệu duyệt, các không gian thực, quan hệ lô đất/nhà liền kề, các detail đã xác minh, reference/master. Lưu trong Project DNA extension hoặc các registry dự án.

**Shot Intent (theo từng ảnh):** `targetSpaceId`, `cameraIntent`, `targetDetailId`, `objectRequests`, `effectProfile`, `outputFormat`; chốt thành snapshot cho job. Không lén chỉnh ngược Project DNA.

**Post-processing Job:** asset nguồn, chế độ preservation, vùng được phép chỉnh, upscale target, provider, QC. Luôn tạo asset phiên bản mới.

**Diagram/Publication:** tài liệu phái sinh tham chiếu `assetId` và `sourceHash`; lưu trong collection riêng, không nhồi vào Project DNA.

## 3.2. Luồng tạo ảnh

```text
Project DNA + Knowledge Pack + Space Catalog
  → Fact & Evidence Resolver
  → Site Adjacency / Visibility Resolver
  → Space Preset Resolver (1 targetSpaceId)
  → Camera Intent + Detail Shot Planner
  → Scene Object Placement Validator
  → Lighting / Weather / Optical & Motion Resolver
  → Unified Conflict Validator (BLOCK / WARN / ALLOW)
  → Structured Prompt Compiler (stable sections + version)
  → Provider Capability Adapter → Generation Job
  → Asset + QC + Version Lineage
```

Các module Enhance, Diagram và Publishing **đọc asset/dữ liệu được duyệt** từ luồng trên nhưng có prompt/job và validator riêng; không gọi lại prompt tạo kiến trúc chỉ để xuất bản.

## 3.3. Thứ tự ưu tiên ràng buộc

1. Khóa hình học, boundary, công trình liền kề, reference master đã duyệt.
2. Thực tế có bằng chứng (mặt bằng, hình tham chiếu, kích thước đo).
3. Vị trí cửa/mặt thoáng/tầm nhìn và giới hạn che khuất đã xác nhận.
4. Không gian đích, công năng, đồ nội thất và vật liệu đã khóa.
5. Điều kiện vật lý: diện tích đặt vật thể, giao thông, nguồn sáng, vị trí camera.
6. Đề xuất bố trí/ánh sáng/phong cách có thể thay đổi.
7. Trang trí, hiệu ứng điện ảnh, AI sáng tạo bổ sung.

Khi xung đột, **cấp thấp hơn phải nhường cấp cao hơn**. User có thể xác nhận một ngoại lệ đối với tùy chọn mềm; **không thể vô hiệu hóa khóa cứng chỉ bằng một câu prompt**. Cần thao tác sửa Project DNA có kiểm soát, được lưu lịch sử.

## 3.4. Bằng chứng và độ tin cậy

Mỗi dữ kiện quan trọng có `status: verified | inferred | unknown | user_declared`, `sourceAssetIds`, `confidence` (nếu AI suy luận), `approvedByUser`. `inferred` không bao giờ được hiển thị là kích thước đo chính xác. Nếu camera/diagram yêu cầu dữ liệu thiếu thì cảnh báo hoặc dùng phương án không khẳng định phần bị khuất.

# 4. Module A — Building & Space Catalog V3

## 4.1. Danh mục loại công trình

| Archetype | Số preset hiện có | Nhóm không gian tiêu biểu |
|---|---:|---|
| Nhà phố (`townhouse`) | 35 | Khách+bếp, phòng ngủ, cầu thang/giếng trời, sân sau hẹp, sân thượng, gara. |
| Biệt thự (`villa`) | 44 | Sảnh, phòng khách, master suite, giải trí, sân vườn, hồ bơi, garage. |
| Căn hộ (`apartment`) | 27 | Khách+bếp, studio, phòng ngủ, loggia, duplex, penthouse. |
| Khách sạn (`hotel`) | 24 | Lobby, reception, phòng lưu trú, lounge, nhà hàng, back-of-house. |
| Resort (`resort`) | 22 | Villa suite, bungalow, pool villa, spa, outdoor dining, cảnh quan. |
| Cafe (`cafe`) | 19 | Quầy order/pha chế, khách ngồi, ngoài trời, kho, khu rửa. |
| Nhà hàng (`restaurant`) | 16 | Khu ăn, phòng VIP, bếp mở, bếp chính, sân hiên, phụ trợ. |
| Văn phòng (`office`) | 18 | Reception, open office, meeting, executive room, pantry. |
| Thương mại/showroom (`retail`) | 12 | Trưng bày, trải nghiệm, thanh toán, thử đồ, kho. |
| Giáo dục (`education`) | 13 | Lớp, thư viện, thực hành, hành lang, canteen. |
| Y tế (`healthcare`) | 13 | Đón tiếp, chờ, khám, điều trị, hỗ trợ. |
| Công cộng/văn hóa (`public`) | 13 | Sảnh, triển lãm, hội trường, workshop, phụ trợ. |
| **Tổng** | **256** | Nội thất + ngoài trời + bán ngoài trời. |

**Lưu ý:** 256 là số mục trong gói mẫu, không phải cam kết đủ mọi công năng/biến thể. Những phòng chuyên ngành cần chuyên gia rà soát trước sản xuất.

## 4.2. Giao diện mới

- Wizard đầu tiên: **Loại công trình → Tầng/Khu vực → Nhóm chức năng → Không gian cụ thể → Biến thể**.
- Khi chọn nhà phố, hiển thị “khách+bếp liên thông”, “sân sau hẹp”, “giếng trời”, “sân thượng”; không gợi ý mặc định “hồ bơi biệt thự rộng”.
- Khi chọn biệt thự, hiển thị “sảnh”, “master suite”, “phòng giải trí”, “sân vườn rộng”; các tiện ích nâng cao đánh dấu *tùy chọn*.
- Cho phép **“Không gian khác / tùy chỉnh”** và xác nhận những trường hợp đặc biệt, không khóa cứng sáng tạo hợp lệ.
- Mỗi dự án có cây phân tầng (floor → space instances) và một `activeSpaceId` trên màn tạo ảnh.
- Hiển thị thẻ `Đã xác minh / Chưa rõ / Theo ảnh tham chiếu`; các kích thước chưa đo để trống.

## 4.3. Schema và quy tắc

Mở rộng `ProjectDNASchema` bằng `spaceCatalog?: SpaceProjectExtension` (phiên bản extension riêng), gồm `buildingArchetype`, `spaces[]`, `activeSpaceId`, `spacePresetVersion`, `floorId`, `verifiedFacts`, `lockedElements`, `approvedOptionalElements`. Tất cả ID stable; không gắn trực tiếp toàn bộ JSON catalog vào project.

Mỗi `SpacePreset` có `id`, `buildingArchetypes[]`, `category`, `spaceType`, `variants`, `availability`, `requiredIfVerified`, `optional`, `forbiddenUnlessConfirmed`, `cameraIntentIds`, `objectCategoryRules`, `promptTemplateId`.

- `required`: phải xuất phát từ công năng hoặc dữ liệu đã xác nhận; **không tự thêm** cấu kiện khi thiếu bằng chứng.
- `optional`: chỉ thêm khi người dùng chọn và có chỗ đặt.
- `forbiddenUnlessConfirmed`: chặn mặc định, mở có điều kiện sau khi xác minh.
- Chỉ biên dịch preset ứng với `activeSpaceId`, không nối mô tả của tất cả phòng.

## 4.4. Prompt phải đổi

**Bỏ:** prompt chung chung `modern interior, beautiful furniture, luxury space` hoặc tiền giả định mọi phòng khách là căn hộ 5×6×3 m.

**Thêm:** `SPACE SCOPE`, `VERIFIED GEOMETRY`, `FUNCTIONAL LAYOUT`, `LOCKED FURNITURE/MATERIALS`, `ALLOWED OPTIONS`, `FORBIDDEN UNVERIFIED FEATURES`.

**Mẫu nhà phố — sân sau hẹp:**

```text
ACTIVE SPACE: Verified narrow rear courtyard of an attached urban townhouse.
Preserve the plot boundaries, shared walls, existing rear openings, drainage and usable circulation.
Use only confirmed dimensions and approved planting/hardscape elements.
Maintain believable compact scale; no invented side garden, swimming pool,
new doors, expanded lot or panoramic side glazing.
Render this courtyard only; do not merge living-room or villa-garden presets.
```

# 5. Module B — Camera, Site & Detail Engine V4.1–V4.2

## 5.1. Camera đơn giản cho người phổ thông

UI mặc định hỏi: **“Bạn muốn nhìn gì?”** với thẻ hình: chính diện, nhìn chéo từ đường, từ vị trí người đi bộ, toàn cảnh, tiệm cận, chi tiết, từ trên cao *nếu phù hợp*. Sau đó hỏi **“Ảnh dùng để làm gì?”** (ngang/dọc/vuông). Không yêu cầu nhập tiêu cự/azimuth/height.

Ba mức giao diện:

- **Dễ dùng (mặc định):** chọn mục đích, góc, cảm giác không gian.
- **Tùy chỉnh:** thanh trượt gần/xa, cao/thấp, rộng/tập trung.
- **Chuyên gia:** giữ `CameraDirector`, azimuth, elevation, height, lens, distance, anchor.

Lớp `VisualIntentResolver` chuyển lựa chọn thường ngày thành gợi ý Camera DNA; trường đo thực tế vẫn có thể trống, không bịa khoảng cách.

## 5.2. Site Adjacency DNA — bảo toàn hàng xóm

Dữ liệu tối thiểu: `front/left/right/rear` với loại `attached_building | street | open_space | boundary_wall | unknown`, quan hệ chủ thể, nguồn bằng chứng, vật thể che khuất. Định nghĩa thống nhất bên trái/phải theo người **đứng ngoài nhìn vào mặt tiền**, đồng thời nêu quy ước tọa độ camera để không đảo chiều.

**Tình huống bắt buộc:** nhà phố giữa dãy, camera nhìn chéo 45° từ bên trái. Hệ thống vẫn phải giữ nhà bên trái/phải và chỉ nhìn mặt tiền dưới góc xiên; **không biến lô đất thành lô góc, không tạo mặt hông mới**.

`VisibilityResolver` trả `visibleFacades`, `occludedFacades`, `warnings`, `confidence`, `feasibleCameraZones`; không tuyên bố visibility chính xác nếu chưa có cao độ, setback và hình học hàng xóm. Có thể vẫn cho góc nhìn chéo hợp lệ nhưng **cảnh báo phần bị che**.

**Prompt cốt lõi:**

```text
SITE & OCCLUSION PRESERVATION:
The target townhouse remains attached to the verified neighboring buildings.
Use an oblique street-level viewpoint of the front facade only.
The oblique camera angle does not imply an exposed side elevation.
Preserve adjacent buildings, shared boundaries and realistic occlusion.
Never clear neighboring plots or relocate contextual buildings to reveal a side facade.
```

## 5.3. Góc tiệm cận và chi tiết

Ba loại:

1. `approach`: gần công trình hơn nhưng còn đủ bối cảnh định vị.
2. `architectural_detail`: một cấu kiện chính (ban công, lan can, lam, cửa, tay vịn, đèn...).
3. `material_closeup`: chi tiết vật liệu/mối nối; không tự đổi chủng loại vật liệu.

UI: Chọn **“Khám phá chi tiết” → danh sách chi tiết xác nhận → số ảnh 1–10 (mở rộng linh hoạt) → tự chọn/tự đề xuất**. **Số ảnh ≠ số chi tiết mới phải tạo**; một detail hợp lệ có thể có hai góc, hoặc cảnh báo thiếu chi tiết.

`ArchitecturalDetailRegistry`: `id`, `spaceId`, `facade`, `floorId`, `verifiedLocation`, `materialIds`, `existence`, `sourceAssetIds`, `locked`. `DetailShotPlanner` chọn `targetDetailId`, camera có khả năng nhìn thấy, tránh góc trùng nhau và không đặt xe/người vào ảnh macro nếu ngoài khung.

**Prompt chi tiết ví dụ:**

```text
DETAIL TARGET: Approved second-floor FRONT balcony of the townhouse.
Focus on the existing railing, surface finish, material junctions and adjacent openings.
Maintain the exact floor, facade, proportions and approved materials.
Use a plausible camera location from the street; retain neighboring buildings
where visible. Do not invent a free side elevation, extra windows or a new balcony.
```

## 5.4. Kiểm thử camera bắt buộc

- Nhà phố liền kề + `front-left` không sinh chỉ thị `show two exposed façades`.
- Nhà phố lô góc đã xác minh có thể xem hai mặt thật.
- Phòng ngủ không có preset camera bay trên mái.
- Detail ban công tầng 2 giữ đúng tầng và mặt đứng; góc không thấy target phải trả `WARN/RESELECT`.
- Chuyển giao diện Simple ↔ Expert giữ dữ liệu camera gốc.

# 6. Module C — Optical & Motion Effects Engine V4.3

## 6.1. Hiệu ứng và ràng buộc

| Effect | Mục đích nhìn thấy | Điều kiện/giới hạn |
|---|---|---|
| Long exposure — người/xe | Bóng mờ người, vệt đèn xe | Chỉ trên đường/lối đi có thật, xe đang chạy, cảnh đủ tối nếu là vệt đèn. |
| Long exposure — mây/nước | Mây kéo vệt, nước mượt | Phải có bầu trời hoặc nước thật; không dùng trong phòng kín. |
| Sunstar / Starburst | Tia sao ở nguồn sáng điểm | Nguồn sáng hiện hữu, camera/hướng sáng hợp lý; không sinh mặt trời thứ hai. |
| Lens flare | Lóe sáng nhẹ | Tương thích hướng nguồn sáng; không che chi tiết cần thấy. |
| Atmospheric glow / god rays | Các luồng sáng thể tích | Chỉ nơi có khe/cửa và môi trường cho phép; không xuyên tường đặc. |
| CPL/reflection control | Giảm/nhấn phản xạ kính/nước | Phụ thuộc góc camera/vật liệu; không cho phép nhìn xuyên vật thể không có trong ảnh gốc. |

Các gợi ý như phơi sáng vài giây, f/11–f/16 là **mô tả hiệu ứng**, không bảo đảm mô phỏng quang học vật lý chính xác từ prompt. Không áp hiệu ứng như thông số camera thật nếu model/provider không hỗ trợ.

## 6.2. Giao diện

Người dùng chọn bằng tên cảm nhận: “Vệt sáng xe”, “Người chuyển động mờ”, “Mây mềm”, “Nước mượt”, “Tia sao”, “Lóe sáng nhẹ”, “Luồng sáng”, “Giảm phản xạ kính”. Thanh trượt nhẹ/vừa/mạnh; **mặc định OFF**, 1 hiệu ứng chính/ảnh; các hiệu ứng thứ cấp chỉ kết hợp khi tương thích.

`EffectsCompatibilityMatrix` kiểm tra với Space, Site, Camera, Weather, Lighting, Scene Objects; kết quả `available | conditional | blocked`, kèm lý do dễ hiểu.

**Prompt chuyển động ví dụ:**

```text
Keep all architecture, roads and neighboring buildings static and sharply defined.
Apply subtle long-exposure light trails ONLY to moving vehicles on the existing road.
Do not introduce new lanes, widen the street, remove parked vehicles or blur the building.
```

# 7. Module D — Scene Objects & Lifestyle V4.4

## 7.1. Loại đối tượng

`person`, `car`, `motorbike`, `bicycle`, `plant`, `pet`, và giai đoạn sau `street_furniture`, `outdoor_furniture`, `service_equipment` theo danh mục có kiểm soát. Mặc định **không thêm vật thể mới** nếu người dùng chưa bật chế độ đề xuất hoặc chọn rõ.

Giao diện: **Không gian đích → danh mục cho phép → preset cụ thể → số lượng → vị trí (anchor/zone) → trạng thái đứng yên/chuyển động → xem trước/cảnh báo**. Ẩn hoặc khóa lựa chọn bất khả thi; có ngoại lệ hợp lệ cho gara trong nhà, showroom ô tô.

| Không gian | Cho phép thường gặp | Loại trừ/điều kiện |
|---|---|---|
| Phòng khách, phòng ngủ | Người, thú cưng, chậu cây | Cấm xe hơi/xe máy trừ thiết kế trưng bày đặc biệt có xác nhận. |
| Mặt tiền nhà phố | Người, xe trên đường thật, xe máy | Không thêm gara/sân đỗ mới, không đặt xe chắn lối và che mặt tiền. |
| Gara hoặc driveway | Ô tô, xe máy, người | Yêu cầu kích thước/không gian tiếp cận và khoảng hở hợp lý. |
| Sân biệt thự | Xe đỗ, người, thú cưng, cây | Chỉ ở vùng có bề mặt đặt xe/hardscape phù hợp. |
| Cafe / nhà hàng | Khách, nhân viên, cây cảnh | Xe chỉ ngoài khu xe/đường; không nằm trong sảnh ăn. |
| Hồ bơi resort | Người, đồ dùng hồ bơi hợp lệ | Không đặt xe trong bể hoặc trên sàn không chịu tải. |
| Showroom xe | Ô tô trưng bày, khách | Cho phép ngoại lệ nội thất, phải kiểm tra clearances. |

## 7.2. Thư viện xe định danh chính xác

Preset ban đầu:

- `car.mercedes_300sl.gullwing`: **Mercedes-Benz 300 SL Gullwing coupe**, thân xe thấp, cửa mở cánh chim; **Roadster** là biến thể khác, không tự trộn.
- `car.shelby_cobra.1964_289`: **Shelby/AC Cobra 289 đời 1964**; kiểm soát đặc trưng thời kỳ, không tự áp thân xe Cobra 427 đời sau.
- `car.jaguar_e_type.series1`: **Jaguar E-Type Series 1**, tách coupe/roadster, màu sơn do người dùng chọn.
- Nhóm bổ sung: classic European GT, modern luxury sedan, SUV, EV, xe đô thị Việt Nam, xe máy, xe đạp.

Các model AI có thể không tái tạo chính xác huy hiệu/niên đại chi tiết; UI phải hiển thị **“mô phỏng theo mẫu xe”**, dùng ảnh tham chiếu có quyền sử dụng nếu cần chính xác và cảnh báo khi xuất bản thương mại liên quan nhãn hiệu.

`SceneObjectRequest`: `presetId`, `quantity`, `targetSpaceId`, `placementZoneId`, `static/moving`, `appearanceOverrides`, `visibility`, `sourceReferenceIds`. `ObjectPlacementValidator` chặn va chạm, thiếu bãi đỗ, lệch tỷ lệ, che cấu kiện khóa; không tự tạo driveway.

**Prompt ví dụ:**

```text
Add ONE parked 1950s Mercedes-Benz 300 SL Gullwing coupe
on the VERIFIED villa driveway, if the driveway has adequate clearance.
Preserve the original driveway shape, garden edge, house facade and camera.
Keep the car static and physically grounded; no new garage, widened road or altered building.
```

# 8. Module E — Render Enhancement Studio V5

## 8.1. Mục tiêu và ba chế độ

Nâng **ánh sáng, phản ứng vật liệu, chiều sâu cảm nhận, cân bằng màu, độ rõ và tính chân thực** mà không thay đổi số tầng, cửa, tường, mái, đồ nội thất, bố trí, khu đất hay góc camera.

| Chế độ người dùng | Cơ chế mặc định | Giới hạn |
|---|---|---|
| **Giữ nguyên chi tiết** (`strict`) | Chỉnh cục bộ không tạo sinh: exposure, tone, denoise, color, sharpen | Không tạo mới vân/chi tiết; không đổi hình học. |
| **Nâng cấp thông minh** (`balanced`) | Local trước; AI image edit chỉ ở vùng cho phép; composite vùng khóa | Phải QC và duyệt nếu cảnh báo. |
| **Nâng cấp mạnh** (`creative`) | AI chỉnh mạnh hơn trong phạm vi vùng được phép | Không quảng bá là bảo toàn tuyệt đối; review bắt buộc. |

UI dùng các cụm phổ thông: “Chân thực tự nhiên”, “Sáng sạch”, “Ấm áp”, “Cao cấp”, “Dịu nhẹ”; slider **Ánh sáng / Độ rõ vật liệu / Độ trong ảnh**, checkboxes cứu vùng sáng, bóng tối, phản xạ kính, noise.

## 8.2. Bảo vệ theo vùng

- `Geometry Lock`: biên dạng, mở cửa, mái, trần/sàn, vật thể đã khóa.
- `Material Lock`: phân vùng vật liệu, màu/vân đã duyệt; chỉ cải thiện phản ứng ánh sáng trong giới hạn.
- `Context Lock`: nhà liền kề, đường, cây, xe/người đã xác nhận.
- `Camera Lock`: góc, phối cảnh, crop, tỷ lệ khung.
- `Region Allow Mask`: chỉ vùng cho phép AI sửa. Mask không phải cam kết AI tuân thủ tuyệt đối; **composite lại pixel vùng khóa từ ảnh gốc** (ở cùng độ phân giải/đăng ký ảnh).

QC: kiểm tra kích thước, image registration, đường biên, SSIM/LPIPS có mục tiêu, màu vùng khóa, phát hiện thêm/bớt cấu kiện và Vision QC hỗ trợ. Mọi điểm QC có thể bỏ sót lỗi; `strict` cần quy tắc pixel/processing xác định, `balanced/creative` vẫn cần người duyệt.

**Prompt AI Enhance:**

```text
TASK: Enhance the provided architectural render; DO NOT redesign.
SOURCE OF TRUTH: The original approved image and locked Project/Site/Space facts.
ALLOWED: improve light balance, shadow detail, physically plausible material response,
noise and photographic clarity in the editable regions only.
PRESERVE: exact geometry, doors, windows, roof, floors, furniture positions,
material assignments, site neighbors, perspective and original framing.
DO NOT: add, remove, move, replace or reinterpret architectural/scene objects.
If uncertain, keep the source unchanged and flag for review.
```

## 8.3. Tích hợp hiện có

Mở rộng `EnhanceParamsSchema` tùy chọn; tái sử dụng `EnhancePanel`, `EnhanceBatchDialog`, `RegionCanvas`, Rust `mask.rs` và pipeline asset/QC. Mọi phiên bản nâng cấp có `parentAssetId`, `inputHash`, `configHash`, `provider/model`, `preservationMode`, `qcReportId`.

# 9. Module F — Upscale 2K/4K & Batch V5.1

## 9.1. Đầu ra và cách tính

Hai chế độ kích thước **không được đánh đồng**:

- `long_edge_2048`, `long_edge_4096`: cạnh dài bằng 2048/4096 pixel, **giữ đúng tỷ lệ gốc**.
- `UHD_3840x2160`: chỉ khi khung hình 16:9 hoặc người dùng chọn contain/letterbox; không tự cắt mái/cửa.
- `custom`: kích thước tự chọn; phải quy định contain/fit, không kéo giãn hình.

Nếu ảnh đã đủ lớn, cho chọn giữ nguyên / chỉ xử lý chất lượng / skip; không downscale vô ý. Cho 1 ảnh hoặc batch, từng ảnh là một job có trạng thái riêng, resume/retry có kiểm soát tính phí.

## 9.2. Router công nghệ

| Backend | Khi nào chọn | Chú ý |
|---|---|---|
| **Local Lanczos3** (đã có) | Giữ chi tiết, nhanh, không API | Không phục hồi chi tiết bị thiếu. |
| **API AI super-resolution** | Người dùng không có GPU, batch tùy nhu cầu | Kiểm tra capabilities, pricing, kích thước, privacy và mức hallucination theo model. |
| **ComfyUI local** | Máy trạm có GPU phù hợp, workflow tùy biến/tiled upscale | Không bắt người phổ thông cài; cần quản lý phiên bản model/VRAM. |
| **ComfyUI remote GPU** | Khối lượng lớn, doanh nghiệp | Bắt buộc xác thực, private networking, quota; không mở API trần Internet. |

**Khuyến nghị:** Hybrid; `Strict` dùng local; `AI Quality` ưu tiên API; ComfyUI là provider tùy chọn. VPS CPU nhỏ không phải máy chạy upscale AI 4K hợp lý. Không khóa theo một nhà cung cấp/model cụ thể; dùng `UpscaleProviderCapabilities` (`maxPixels`, `supportsTiling`, `imageToImage`, `privacyClass`, `costEstimate`).

## 9.3. Batch UI và QA

Chọn nhiều ảnh → preset 2K/4K → mức bảo toàn → backend Auto/Local/API/Comfy → xem trước giá ước lượng → chạy hàng đợi → danh sách progress, retry, skip, QC, export ZIP/folder. Không tự gửi trả phí trước khi người dùng xác nhận giá nếu ước lượng có sẵn; nếu không biết giá, hiển thị **“Chưa xác định chi phí”**.

Các bài test: giữ aspect; đúng long edge; PNG alpha; ảnh đã vượt mục tiêu; error per-item không làm hỏng batch; cache/retry không tính phí trùng do submit lại; so sánh và không đè ảnh gốc.

# 10. Module G — Architectural Diagram Studio V6

## 10.1. Mục đích và 6 nhóm

1. **Concept Evolution:** hình thành phương án từ khu đất đến khối cuối (mẫu video 6 giai đoạn).
2. **Massing & Voids:** khối đặc, sân trong, giếng trời, khoảng rỗng.
3. **Functional Zoning:** phân khu công năng có căn cứ.
4. **Circulation:** lối vào, cầu thang và luồng di chuyển xác nhận.
5. **Sunlight/Ventilation:** phân tích có hướng Bắc, cửa mở, địa điểm hoặc mô hình.
6. **Facade & Material:** cấu kiện, phân lớp và vật liệu đã biết.

Với **nhà phố** ưu tiên giếng trời, độ sâu, liền kề, tổ chức theo tầng; với **biệt thự** ưu tiên chia khối, lối tiếp cận, sân vườn, trong–ngoài. Không mặc định cùng sáu bước *Site → Extrude → Subtract* cho mọi công trình.

## 10.2. Dữ liệu đầu vào và giao diện

Chọn ảnh render + tùy chọn mặt bằng/mặt đứng/3D → loại diagram → số bước 4/6/8 hoặc tùy chỉnh → layout 2×2/2×3/2×4/tuyến tính → ngôn ngữ Việt/Anh → xuất PNG 2K/4K và/hoặc MP4.

`DiagramStep.evidence` là `verified | inferred | illustrative`; các bước không được xác minh phải được dán nhãn **“sơ đồ diễn giải ý tưởng”**. Không suy từ một mặt tiền thành bản vẽ chính xác của phòng phía sau. Cho phép sửa từng bước, chấp thuận trước khi xuất.

## 10.3. Pipeline và video

`Vision Analyzer → Fact Extractor → Step Planner → Fixed Isometric Render → SVG Text/Arrow Renderer → Review → PNG/PDF/MP4`. Text, mũi tên và nhãn được dựng **bằng vector/text engine**; không giao AI image model vẽ chữ quan trọng. Mọi khung dùng một góc isometric và hệ màu ổn định.

Video: chỉ tạo sau khi các bước được duyệt; dựng bằng FFmpeg từ các frame/diagram tĩnh (pan/zoom/appear) để tránh nhảy chữ và biến dạng khối. Morph 3D chính xác cần mô hình 3D hoặc hình học được kiểm soát.

**Prompt concept diagram:**

```text
Create a clean architectural axonometric CONCEPT diagram using ONLY verified
massing facts and approved illustrative design steps. Keep one fixed camera,
consistent proportions and drawing style across all panels.
Do not imply unseen floor plans or hidden structure have been measured.
Leave all labels and arrows to the vector layout compositor.
```

# 11. Module H — Publishing Studio V7.0–V7.2

## 11.1. Bốn định dạng

| Định dạng | Mục tiêu | Nội dung/typography ưu tiên |
|---|---|---|
| **Portfolio** | Tôn vinh công trình | Hero image, các không gian, góc chi tiết, chữ cô đọng. |
| **Catalog** | So sánh nhiều phương án/không gian | Lưới, nhãn, đặc tính được xác nhận, tổ chức mục lục. |
| **Concept Book** | Giải thích quyết định thiết kế | Diagram, hình khối, công năng, vật liệu, trình tự. |
| **Magazine** | Kể chuyện biên tập | Headline, pull quote (không bịa lời người thật), ảnh lớn, nhịp điệu trang. |

Dữ liệu dự án/tài sản được tham chiếu qua `assetId`; không xuất lại ảnh bằng image generation chỉ để làm layout. Có editor cho đổi ảnh, kéo thả, khóa trang, sửa caption, xem trước và duyệt.

## 11.2. Thư viện style màu và layout V7.1

Tối thiểu 4 nhóm style riêng theo ấn phẩm:

- **Portfolio:** Minimal White, Warm Beige, Dark Luxury, Earth Tones.
- **Catalog:** Corporate Blue, Modern Grid, Premium Gold, Urban Grey.
- **Concept:** Architectural Red, Blueprint Blue, Concrete Grey, Natural Green.
- **Magazine:** Editorial Black, Vogue Minimal, Contemporary Art, Retro Modern.

Mỗi style gồm `palette`, font families/tỷ lệ chữ, spacing, margins, divider, caption, cover rules và layout cho số ảnh khác nhau. Layouts: hero full page, 1 hero + phụ, lưới 2×2 / 2×3 / linh hoạt, split, editorial bất đối xứng, diagram sheet.

**Random 3 mức:** đổi Style toàn cuốn; đổi Layout từng trang; Smart Random theo chủ đề/ảnh. Random cần `seed` tái tạo, không xáo lại nội dung/dữ kiện, hỗ trợ `lockedPageIds`, mặc định đồng bộ palette của cả cuốn. Chế độ biến đổi màu theo chương phải được chọn rõ.

## 11.3. Exact Page Budget V7.2 — ràng buộc cứng

Đầu vào: `selectedImageIds`, `targetPageCount` (số nguyên ≥1), `include_all | ai_select`, loại ấn phẩm, khổ giấy, mật độ chữ, `styleId`, layout mode, seed, trang khóa. Output **phải có đúng `targetPageCount` trang**.

- `include_all`: tất cả ảnh được chọn phải xuất hiện **đúng một lần**, trừ khi user bật lặp ảnh có chủ đích. Không bỏ ảnh, không thêm ảnh mới.
- `ai_select`: AI có thể chọn subset nhưng **vẫn đúng số trang**; giải thích ảnh nào được chọn và vì sao.
- Nếu số trang > số ảnh, cho trang chữ/bìa/diagram hợp lệ theo loại tài liệu, nhưng không tạo ảnh giả.
- Nếu 10–20 ảnh trong một trang A4/A3, ưu tiên khung ảnh chính + thumbnail nhóm, caption theo cụm, ít chữ; cảnh báo chữ/ảnh quá nhỏ và đề nghị A3/digital. Không âm thầm đổi trang.
- Thay đổi khổ hoặc số trang chỉ thực hiện sau lựa chọn của người dùng.

**Ví dụ bắt buộc — 1 trang, 10 ảnh, Concept:** ảnh quan trọng nhất chiếm ô chính (nếu cần), 9 ảnh phụ sắp theo nhóm bối cảnh–hình khối–không gian–chi tiết **nếu ảnh có bằng chứng**; một tiêu đề và chú thích rất ngắn theo nhóm. Với **Portfolio** cùng 10 ảnh, ưu tiên ảnh hero và nhịp điệu thị giác, chữ ít hơn. Với **Catalog**, ưu tiên lưới và nhãn so sánh; với **Magazine**, tiêu đề biên tập và ảnh chủ đạo.

`ContentFitValidator` phải đo kích thước ảnh in (effective PPI), cỡ chữ tối thiểu, white space, crop an toàn, overflow và readability. Không coi việc có đúng 10 khung là đủ nếu mọi hình quá nhỏ để sử dụng.

## 11.4. AI viết thuyết minh: phân loại bằng chứng

- `technical`: rõ công năng, vật liệu/chi tiết có nguồn.
- `editorial`: câu chuyện không gian và ánh sáng, không bịa phát biểu/giải thưởng.
- `commercial`: lợi ích, tính năng, số liệu chỉ từ dữ liệu xác nhận.

Mỗi câu nêu số liệu, địa điểm, năm, giải thưởng, vật liệu thương hiệu, tác giả cần `factRef` hoặc đánh dấu `needs_review`. Cho phép văn phong sáng tạo ở tiêu đề nhưng không biến suy luận thành dữ kiện dự án.

**Prompt editorial:**

```text
You are an architectural editor. Write concise Vietnamese captions for the
selected approved images and the chosen publication type.
Use only VERIFIED project facts. Distinguish visible features from inferred intent.
Do not invent areas, project address, architect, construction year, awards,
material brands or client quotations. Return structured text for existing page slots.
Stay within the supplied word and page budget; do not add pages or images.
```

## 11.5. Xuất bản

- MVP: PDF (text/vector, A4/A3/16:9), PNG/JPEG từng trang; preserve source images.
- Nâng cao: bleed/print safe zone, brand kit, bộ ảnh trang mạng xã hội, digital flipbook, video trang đã duyệt qua FFmpeg.
- Khóa phiên bản ảnh bằng `assetId` + `sourceHash`, để ấn phẩm cũ không tự đổi khi dự án có render mới.

# 12. Unified Prompt Compiler — đặc tả sửa prompt

## 12.1. Vì sao cần thay đổi

Hiện compiler có các section `subject → form → language → materials → context → lighting → weather → mood → camera → quality`, reference/preservation tách riêng. Vấn đề là thiếu phạm vi không gian đích, ràng buộc nhà liền kề, khả năng nhìn thấy và danh sách vật thể, trong khi `withExtraPrompt()` có thể nối text tự do và tạo mâu thuẫn.

## 12.2. Cấu trúc đề xuất cho **generation prompt**

1. `TASK & TARGET` — render ngoại thất/nội thất của một `targetSpaceId`.
2. `SOURCE OF TRUTH` — master/reference đã duyệt và các dữ kiện có bằng chứng.
3. `GEOMETRY & PRESERVATION` — khối, tường, tầng, openings, furniture locks.
4. `SITE & OCCLUSION` — hàng xóm, boundary, che khuất, hướng nhìn.
5. `SPACE FUNCTION & MATERIALS` — công năng, vật liệu, chi tiết xác nhận.
6. `CAMERA & VISIBILITY` — ý định quan sát, framing, targetDetailId.
7. `SCENE OBJECTS` — đối tượng được phép, số lượng, vị trí, chuyển động.
8. `LIGHTING / WEATHER` — điều kiện hợp lệ, quyền ưu tiên khóa.
9. `OPTICAL & MOTION EFFECTS` — chỉ hiệu ứng đã qua validator.
10. `RENDER QUALITY` — mức photorealism, không làm khác kiến trúc.
11. `NEGATIVE CONSTRAINTS` — hợp nhất, khử trùng lặp, không mâu thuẫn với positive.
12. `REFERENCE & PRESERVATION INSTRUCTIONS` — metadata/provenance theo role.

Đối với **Enhance**, **Diagram**, **Publishing**, dùng template và version **riêng theo task**, không đổ mọi thứ vào generation prompt.

## 12.3. Quy tắc biên dịch

- Input là các object theo schema; không ghép preset tùy tiện bằng `string + string`.
- Chỉ có một `activeSpaceId`, một camera chính, tối đa một optical effect chính, một target detail chính cho mỗi shot; `objectRequests` có thể nhiều nếu validator cho phép.
- Khi user nhập free-text, phân tích ý định và đối chiếu với locked facts; mâu thuẫn phải `BLOCK` hoặc cảnh báo cần sửa dữ liệu; không append thẳng vào positive prompt rồi mong negative giải quyết.
- Không có `verified` thì dùng từ ngữ thận trọng (`if present in approved references`), không tự khẳng định kích thước/cửa/cảnh quan.
- Positive, negative, reference, preservation và metadata cùng có `compilerVersion`, `catalogVersion`, `validatorVersion`, `sourceHash`, `configHash`, `resolvedWarnings`.
- Cùng snapshot đầu vào + version phải sinh **prompt byte-identical**; thứ tự arrays/maps, định dạng số, xử lý dấu cách ổn định.

## 12.4. Mã cảnh báo/lỗi thống nhất

| Mã | Mức | Ý nghĩa |
|---|---|---|
| `SPACE_NOT_IN_BUILDING` | BLOCK | Preset không thuộc archetype hiện tại. |
| `UNVERIFIED_GEOMETRY` | WARN/BLOCK | Yêu cầu chính xác kích thước khi dữ liệu chưa xác minh. |
| `OCCLUDED_TARGET` | WARN/BLOCK | Camera không thấy hoặc khó thấy chi tiết mong muốn. |
| `ADJACENT_BUILDING_CONFLICT` | BLOCK | Prompt muốn làm lộ hông bằng cách xóa nhà kề. |
| `OBJECT_NOT_ALLOWED_IN_SPACE` | BLOCK | Xe trong phòng ngủ hoặc vật thể sai công năng. |
| `OBJECT_NO_PLACEMENT_ZONE` | WARN/BLOCK | Thiếu vùng đặt hợp lý hoặc rõ ràng. |
| `EFFECT_SOURCE_MISSING` | BLOCK | Sunstar không có nguồn sáng; water blur không có nước. |
| `EFFECT_MOTION_CONFLICT` | BLOCK | Xe đang đỗ nhưng yêu cầu vệt sáng do xe đó chạy. |
| `LOCKED_LIGHTING_CONFLICT` | BLOCK | Chế độ đêm mâu thuẫn ánh sáng đã khóa. |
| `ENHANCE_PRESERVATION_RISK` | WARN/BLOCK | AI sửa vùng khóa hoặc hình học có dấu hiệu thay đổi. |
| `OUTPUT_SIZE_MISMATCH` | BLOCK | Kích thước không đạt profile đã yêu cầu. |
| `PAGE_COUNT_MISMATCH` | BLOCK | Số trang khác targetPageCount. |
| `REQUIRED_IMAGE_MISSING` | BLOCK | Thiếu ảnh bắt buộc trong include_all. |
| `PRINT_READABILITY_LOW` | WARN | Độ phân giải, chữ hoặc bố cục không đủ dễ đọc. |
| `UNVERIFIED_PUBLICATION_FACT` | BLOCK | Nội dung công bố dữ kiện không có nguồn hoặc chưa duyệt. |

UI thể hiện `BLOCK` bằng lý do và nút **Sửa lựa chọn**; `WARN` có dấu hiệu và tùy chọn **Duyệt ngoại lệ** nếu policy cho phép; `ALLOW` không cần làm phiền người dùng.

# 13. Giao diện ứng dụng — thay đổi tổng thể

## 13.1. Điều hướng gợi ý

1. **Dự án & Không gian** — chọn công trình, bản vẽ, phòng, site adjacency, master và locks.
2. **Tạo ảnh** — chọn không gian, camera đơn giản, effect, scene objects, chuyên gia mở rộng.
3. **Khám phá chi tiết** — chọn bộ phận đã xác nhận, số góc/ảnh, xem shot plan.
4. **Enhance & Upscale** — một ảnh/hàng loạt, 2K/4K, local/API/Comfy.
5. **Diagram Studio** — concept/massing/zoning/circulation/climate/materials, ảnh/video.
6. **Publishing Studio** — Portfolio/Catalog/Concept/Magazine, đúng số trang, style/random, page editor.
7. **Asset & Quality** — thư viện ảnh, versions, compare, QC, export.

Khi chưa triển khai đủ, dùng feature flags; không mở nút dẫn vào module rỗng. `CameraDirector` giữ nguyên ở chế độ Expert.

## 13.2. Mẫu màn hình Create Image (người phổ thông)

```text
[Tên dự án / Phiên bản thiết kế đã duyệt]
Loại công trình: Nhà phố                 [Đổi]
Không gian: Tầng trệt > Phòng khách+bếp  [Đổi]
Góc nhìn: [Toàn phòng] [Từ cửa vào] [Tiệm cận] [Chi tiết]
Cảm giác: [Tự nhiên] [Ấm] [Buổi tối]
Vật thể bổ sung: [Không] [+ Người] [+ Cây]  (Xe bị khóa tại phòng khách)
Hiệu ứng: [Không] [Lóe sáng nhẹ...]      (tùy khả dụng)
Ảnh sử dụng: [Ngang] [Dọc] [Vuông]
[Kiểm tra ràng buộc]  [Xem prompt]  [Tạo ảnh]
[Cài đặt Camera chuyên gia ▾]
```

## 13.3. Mẫu màn hình Publishing

```text
Loại: [Concept] [Portfolio] [Catalog] [Tạp chí]
Ảnh đã chọn: 10                       Chính sách: [Dùng đủ 10]
Số trang: [ 1 ]                       Khổ giấy: [A3 ngang]
Mật độ chữ: [Ít chữ]                  Ngôn ngữ: [Tiếng Việt]
Style: [Architectural Red ▾] [Ngẫu nhiên style] [Ngẫu nhiên layout]
[Page 1: hero + 9 ảnh phụ, nhóm chú thích]  [Khóa trang]
[Kiểm tra đọc/in] [Xem PDF] [Xuất PDF / PNG]
```

**Hiển thị preview thật trước khi xuất**, không hứa “AI tự dàn trang tốt” mà không đo nội dung và chất lượng in.

# 14. Schema hợp nhất — mô hình TypeScript tham chiếu

Đây là bản giao diện dữ liệu đề xuất; **chưa phải mã compile-ready với Zod/Rust hiện hữu**. Cần ánh xạ ID, khóa chính, index DB và migration trong bước lập trình.

```typescript
interface EvidenceRef {
  status: "verified" | "user_declared" | "inferred" | "unknown";
  sourceAssetIds: string[];
  approvedByUser?: boolean;
  confidence?: number;
}

interface SiteBoundary {
  kind: "attached_building" | "street" | "open_space" |
        "boundary_wall" | "unknown";
  evidence: EvidenceRef;
  neighborObjectId?: string;
}

interface SiteExtensionV1 {
  version: 1;
  front: SiteBoundary;
  left: SiteBoundary;
  right: SiteBoundary;
  rear: SiteBoundary;
  coordinateConvention: "viewer_facing_front_facade";
}

interface SpaceInstanceV1 {
  id: string;
  presetId: string;
  floorId?: string;
  facts: Record<string, { value: unknown; evidence: EvidenceRef }>;
  lockedElementIds: string[];
  approvedOptionalIds: string[];
}

interface DetailRecordV1 {
  id: string;
  spaceId: string;
  name: string;
  location?: { facade?: "front" | "rear" | "left" | "right";
              floorId?: string; elementId?: string };
  evidence: EvidenceRef;
  materialIds: string[];
  locked: boolean;
}

interface ProjectExtensionsV1 {
  spaceCatalog?: {
    version: 1;
    buildingArchetype: string;
    spaces: SpaceInstanceV1[];
    activeSpaceId?: string;
  };
  site?: SiteExtensionV1;
  architecturalDetails?: DetailRecordV1[];
}

interface ShotIntentV1 {
  version: 1;
  projectId: string;
  targetSpaceId: string;
  cameraId?: string;
  cameraIntentId?: string;
  targetDetailId?: string;
  objects: Array<{
    presetId: string;
    quantity: number;
    placementZoneId?: string;
    motion: "static" | "moving";
  }>;
  effects: {
    motion?: string;
    optical?: string;
    reflection?: "natural" | "reduce" | "enhance";
    intensity: number;
  };
  output: { aspectRatio: string; requestedCount: number };
}

interface RenderEnhanceRequestV1 {
  sourceAssetId: string;
  mode: "strict" | "balanced" | "creative";
  profileId: string;
  editableRegionIds: string[];
  lockedRegionIds: string[];
  upscale?: {
    target: "long_edge_2048" | "long_edge_4096" |
            "UHD_3840x2160" | "custom";
    provider: "auto" | "local" | "api" | "comfyui";
  };
}

interface PublicationRequestV1 {
  projectId: string;
  type: "portfolio" | "catalog" | "concept" | "magazine";
  selectedImageIds: string[];
  targetPageCount: number;
  imagePolicy: "include_all" | "ai_select";
  textDensity: "minimal" | "balanced" | "detailed";
  styleId: string;
  pageFormat: "A4" | "A3" | "16:9" | "square";
  layoutMode: "auto" | "manual" | "random";
  lockedPageIds: string[];
  randomSeed: number;
}
```

**Khuyến nghị kỹ thuật:** Giữ `ProjectDNASchema.schemaVersion = 1` trong pha thêm optional extensions nếu đường lưu/đọc cũ hỗ trợ; định version từng extension. Nếu cập nhật shape persisted cần migration Zod/Rust/SQLite và kiểm thử roundtrip trước khi phát hành. **Không tự tăng schemaVersion hoặc thay enum để thử nghiệm trên DB thật.**

# 15. Danh sách thay đổi file: hiện có → cần thêm

## 15.1. Domain, registry, prompt

| File hiện tại | Hành động |
|---|---|
| `packages/domain/src/schemas/projectDna.ts` | **Sửa:** thêm optional site/space/detail extensions, locks phân tầng. |
| `packages/domain/src/schemas/future.ts` | **Sửa có kiểm soát:** camera intent metadata/compat; không phá Camera DNA cũ. |
| `packages/domain/src/schemas/generation.ts` | **Sửa:** purpose/params nếu cần cho enhance/upscale và capability flags; Rust DTO tương ứng. |
| `packages/domain/src/knowledge/pack.ts` | **Bổ sung tùy chọn:** tương thích preset cũ; giữ Registry fallback. |
| `packages/domain/src/prompt/compiler.ts` | **Sửa lớn:** section mới, version, conflict gate, deterministic merge. |
| `packages/domain/src/camera/describe.ts` | **Sửa:** tránh hứa nhìn thấy mặt bên khi site blocked. |
| `packages/domain/src/generation/enhance.ts` | **Sửa:** 3 mode strict/balanced/creative; preservation snapshot. |
| `packages/domain/src/index.ts` | **Sửa:** export các schema/resolvers mới. |
| `packages/domain/src/spaceCatalog/*` | **Mới:** loader, schema, resolver, registry, curated presets. |
| `packages/domain/src/site/*` | **Mới:** adjacency/visibility/camera context consistency. |
| `packages/domain/src/detail/*` | **Mới:** registry, planner, visibility, prompts. |
| `packages/domain/src/effects/*` | **Mới:** optical/motion, compatibility rules. |
| `packages/domain/src/sceneObjects/*` | **Mới:** catalogs, placement and prompt rules. |
| `packages/domain/src/qc/*` (mở rộng) | **Sửa/thêm:** post-enhance structural/content preservation QC. |
| `packages/domain/src/diagram/*` | **Mới:** analysis, steps, facts, prompts, schemas. |
| `packages/domain/src/publishing/*` | **Mới:** style, page budget, layout, text, validation. |

## 15.2. Desktop UI và services

| File hiện tại / mới | Hành động |
|---|---|
| `apps/desktop/src/lib/knowledge.ts` | Giữ Knowledge Registry; thêm loader riêng cho Space Catalog. |
| `apps/desktop/src/app/services.ts` | Truyền selected space/shot snapshot vào compiler và submit. |
| `features/generate/extraPrompt.ts` | **Sửa:** validate user free-text với hard locks trước khi append. |
| `features/camera/CameraPanel.tsx` | **Sửa:** Simple + Custom + Expert; camera preset phụ thuộc space/site. |
| `features/camera/CameraDirector.tsx` | **Sửa:** overlays site boundaries, visible facades, detail anchors. |
| `features/enhance/EnhancePanel.tsx` | **Sửa:** profile, strict/balanced/creative, masks, QC. |
| `features/enhance/EnhanceBatchDialog.tsx` | **Sửa:** upscale 2K/4K, provider routing, cost, progress. |
| `features/regions/RegionCanvas.tsx` | **Sửa:** phân biệt vùng khóa/vùng chỉnh. |
| `features/workspace/modules.ts` | **Sửa:** điều hướng Diagram/Publishing, feature flags. |
| `features/space/SpaceSelector.tsx` | **Mới:** xây từ selector V3, nối app state. |
| `features/camera/VisualIntentSelector.tsx` | **Mới:** góc phổ thông và detail shot count. |
| `features/effects/EffectsSelector.tsx` | **Mới:** hiệu ứng theo điều kiện scene. |
| `features/sceneObjects/ObjectPicker.tsx` | **Mới:** thư viện người/xe/cây. |
| `features/diagram/*` | **Mới:** diagram editor, timeline, preview. |
| `features/publishing/*` | **Mới:** image picker, style gallery, page editor, exports. |

## 15.3. Rust/Tauri backend

| File hiện tại / mới | Hành động |
|---|---|
| `src-tauri/src/providers/local_upscale.rs` | **Sửa:** quality profiles, no-downscale policy, progress metadata. |
| `src-tauri/src/services/regions/mask.rs` | **Tái sử dụng/mở rộng:** register ảnh và ghép pixel vùng khóa. |
| `src-tauri/src/services/generations.rs` | **Sửa:** truyền snapshot, lineage, QC metadata, provider support. |
| `src-tauri/src/services/queue.rs` | **Sửa:** batch retry/resume và trạng thái đa provider. |
| `src-tauri/src/providers/upscale_api.rs` | **Mới:** adapter AI super-resolution theo capability. |
| `src-tauri/src/providers/comfyui_upscale.rs` | **Mới:** integration ComfyUI có xác thực. |
| `src-tauri/src/services/diagram_export.rs` | **Mới:** xuất SVG/PNG/video qua renderer/FFmpeg. |
| `src-tauri/src/services/publication_export.rs` | **Mới:** xuất PDF/PNG/ZIP, quản lý template/assets. |

Tên file mới là **đề xuất cấu trúc**, không khẳng định đã tồn tại. Mỗi file Rust cần đồng bộ contract với TypeScript và migrations/repository layer.

# 16. Acceptance tests — tiêu chí nghiệm thu theo hành vi

| ID | Đầu vào kiểm thử | Kết quả bắt buộc |
|---|---|---|
| AC-01 | Nhà phố, chọn phòng khách+bếp | Chỉ thấy preset phù hợp; không lẫn sân vườn biệt thự. |
| AC-02 | Biệt thự, chọn sân vườn rộng | Có camera cảnh quan/objects hợp lệ; không áp furniture phòng ngủ. |
| AC-03 | Nhà phố liền kề trái/phải, camera 45° | Không xóa hai nhà hàng xóm; không tạo mặt hông thoáng. |
| AC-04 | Nhà phố lô góc có xác minh, camera chéo | Cho phép hai mặt đứng có thật. |
| AC-05 | Chụp 5 ảnh detail nhưng chỉ có 3 detail xác minh | Lập các góc khác nhau của 3 detail hoặc báo thiếu; không bịa thêm. |
| AC-06 | Phòng ngủ, bật xe cổ | Chặn với lý do `OBJECT_NOT_ALLOWED_IN_SPACE`. |
| AC-07 | Gara được xác minh, chọn Mercedes 300 SL | Cho phép nếu đủ vùng đỗ, giữ gara và hình học. |
| AC-08 | Xe đỗ, bật traffic light trails do chính xe ấy tạo | Chặn xung đột tĩnh/chuyển động. |
| AC-09 | Nội thất kín, chọn mây kéo vệt | Chặn do không có bầu trời. |
| AC-10 | Nhà phố mặt tiền, Enhance strict | Cửa, nhà kề, mái, framing không thay đổi do AI tạo sinh. |
| AC-11 | Enhance balanced sửa đúng vùng được phép | Các vùng khóa được ghép từ pixel gốc và QC ghi kết quả. |
| AC-12 | Upscale ảnh 3:2 thành long edge 4096 | Giữ 3:2, không crop cấu kiện. |
| AC-13 | Batch 20 ảnh có 2 lỗi API | 18 ảnh thành công được giữ; retry đúng 2 lỗi. |
| AC-14 | Concept từ một ảnh mặt tiền, không có mặt bằng | Không ghi công năng bên trong như đã xác minh. |
| AC-15 | Diagram 6 bước, chọn góc isometric | Các bước giữ tỷ lệ/góc nhất quán; nhãn hiển thị đúng. |
| AC-16 | 10 ảnh, Concept, `include_all`, 1 trang | Đúng 1 trang, đủ 10 ảnh, chú thích theo nội dung, có cảnh báo đọc/in nếu quá chật. |
| AC-17 | 10 ảnh, Portfolio, 1 trang | Một layout phù hợp ảnh hero, ưu tiên hình; **không** dùng y nguyên bố cục Concept. |
| AC-18 | Random layout nhiều lần, 2 trang bị khóa | Trang khóa không đổi, seed cũ phục hồi kết quả cũ. |
| AC-19 | Ấn phẩm có kích thước/giải thưởng chưa được xác minh | Không xuất bản nội dung dưới dạng dữ kiện đã xác nhận. |
| AC-20 | Mở dự án DNA v1 cũ | Load/save/reopen không mất camera, project facts, locks và asset lineage. |
| AC-21 | Compile cùng input + version | Byte-identical PromptBundle. |
| AC-22 | User extra prompt đòi mở mặt hông nhà liền kề | Block trước khi gọi API, hiển thị lý do rõ ràng. |

## 16.1. Kiểm tra kỹ thuật bắt buộc

- Typecheck/lint/unit tests và Rust tests từ `package.json`: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:rust`; thêm integration/e2e tests cho UI.
- Schema migration và roundtrip: DB mở dữ liệu cũ, ghi mới, đọc lại; không bị Zod bỏ mất fields tùy chọn khi parse/save.
- Prompt snapshots/golden tests cho building archetypes, camera + site, effects, objects, masks và edge-cases.
- Provider contract tests với fake/test provider: hỗ trợ mask, upload ảnh, target size, cost, batching và cancellation.
- Visual regression: so sánh 2D masks, khóa cấu kiện, PDF single-page, ảnh 2K/4K, diagram/video.
- Security/privacy: API key ở keychain/env, URL ComfyUI an toàn, không log tài sản nhạy cảm và prompt nguyên vẹn vào bên thứ ba khi chưa có lựa chọn hợp lệ.

# 17. Lộ trình triển khai và mức ưu tiên

| Giai đoạn | Công việc | Đầu ra nghiệm thu |
|---|---|---|
| **P0 — Nền tảng** | Snapshot/project fact layer, schema extensions, unified validator, prompt versioning, test harness | Dự án cũ không hỏng; lỗi `BLOCK/WARN/ALLOW` dùng chung. |
| **P1 — Catalog & Context** | Merge Space Catalog V3, chuẩn hóa nhãn Anh, UI theo công trình; site adjacency, visibility | Chọn đúng phòng; camera chéo nhà phố không xóa hàng xóm. |
| **P2 — Camera & Scene** | Simple Camera, detail shot planner, effects, object library | Góc phổ thông, ảnh chi tiết theo số lượng, xe/người đúng không gian. |
| **P3 — Render Quality** | Enhance preservation masks/QC; upscale 2K/4K batch; API router | Có trước/sau, báo sai lệch, không ghi đè gốc, xử lý batch. |
| **P4 — Diagram** | 6 diagram types, planner, fixed isometric SVG, video | Concept 4/6/8 bước, duyệt step, PNG/MP4 đúng nội dung. |
| **P5 — Publishing** | 4 publications, 16+ curated styles, exact page budget, layout random, PDF/PNG | 10 ảnh/1 trang hoạt động, page locks, font/text rõ, tài liệu in được. |
| **P6 — Nâng cao** | ComfyUI tùy chọn, QC đa model, brand kit/flipbook, video nâng cao | Chỉ làm sau khi MVP ổn định và có benchmark chất lượng/chi phí. |

Không nên làm đồng thời cả bảy studio trước khi hoàn thiện **P0/P1**, vì sự thiếu nhất quán của site/space sẽ lan sang tất cả ảnh, diagram và tài liệu xuất bản.

# 18. Rủi ro cần quản lý

1. **AI hallucination kiến trúc:** prompt không thể bảo đảm hình học; ưu tiên ảnh nguồn, mask, model 3D và QC đa tầng.
2. **Visibility mơ hồ:** không có survey/3D nên chỉ suy luận bảo thủ; không hứa giải được vật thể bị che bằng prompt.
3. **Catalog tên chưa chuẩn:** một phần English prompt trong V3 đang dùng nhãn không dấu; cần biên tập, dịch và review chuyên môn.
4. **Schema cũ và Rust DTO:** optional TS field chưa chắc đã tự truyền qua persistence; cần kiểm thử serialisation và migration thực tế.
5. **Chi phí AI batch:** có nguy cơ retry trùng, output size không đúng, provider thay đổi model; luôn hiển thị chi phí khả dụng và lưu idempotency/job IDs.
6. **ComfyUI GPU:** không chạy AI upscale 4K hiệu quả trên VPS CPU nhỏ; cần cảnh báo VRAM/worker khả dụng.
7. **In ấn một trang quá nhiều ảnh:** có thể không bảo đảm dễ đọc trên A4; bắt buộc layout warning và phương án khổ A3/digital.
8. **Xe cổ và thương hiệu:** model tạo sinh có thể sai đặc điểm lịch sử; cần reference/duyệt trước khi công bố.
9. **Pháp lý dữ liệu:** tài sản, hình tham chiếu, font, template và model phải có quyền sử dụng; người dùng có quyền kiểm soát gửi ảnh lên API.
10. **Độ trễ UI:** phân tích ảnh/AI nên là job có trạng thái, cancel, retry; UI không chặn thao tác dự án.

# 19. Definition of Done — khi nào xem là hoàn tất?

Một module **chưa được xem là xong** nếu chỉ có prompt mẫu hoặc file JSON. Để nghiệm thu phải có đủ: schema versioned, loader/registry, validation, UI state, persistent storage, provider/router/job nếu cần, preview, lỗi dễ hiểu, unit + integration tests, tài liệu người dùng, benchmark chất lượng và không làm hỏng dự án v1.

**Thứ tự triển khai tổng thể được chốt:**

**Space & Site Facts → Unified Validator → Camera/Detail → Effects/Objects → Enhance/Upscale → Diagram → Publishing.**

# Phụ lục A — Các prompt template cần tạo/cập nhật

| Template ID | Task | Mục đích |
|---|---|---|
| `render.space.v3` | image_generation | Một không gian đích, geometry/function/materials/locks. |
| `render.site_occlusion.v4_1` | image_generation | Bảo toàn nhà kề, boundary và visible facades. |
| `render.camera_intent.v4_1` | image_generation | Ngôn ngữ camera phổ thông → viewpoint vật lý hợp lệ. |
| `render.detail_shot.v4_2` | image_generation | Kiểm soát chi tiết, tầng, mặt đứng, vật liệu. |
| `render.motion_optics.v4_3` | image_generation | Optical/motion effects theo điều kiện. |
| `render.scene_objects.v4_4` | image_generation | Xe/người/cây theo vùng đặt và chuyển động. |
| `post.enhance.strict.v5` | image_processing | Không tạo sinh, các thông số local (không nhất thiết có text prompt). |
| `post.enhance.ai.v5` | image_edit | Chỉnh cho phép và bảo toàn các vùng khóa. |
| `post.upscale.v5_1` | super_resolution | Provider capability + output resolution contract. |
| `diagram.analyze.v6` | vision_analysis | Nhận diện/bằng chứng, không bịa mặt bằng không nhìn thấy. |
| `diagram.step_render.v6` | image/geometry render | Cố định isometric, step consistency, không vẽ chữ bằng AI. |
| `publishing.editorial.v7_2` | text_generation | Viết tiêu đề/chú thích có nguồn và giới hạn từ. |
| `publishing.layout_plan.v7_2` | structured_layout | Trả JSON page plan đúng số trang/số ảnh. |

**Bắt buộc:** Mỗi template có `templateVersion`, input schema, output schema, negative rules, golden snapshot và test ít nhất một tình huống xung đột.

# Phụ lục B — Ví dụ end-to-end minh họa

## B1. Nhà phố ống giữa hai nhà kề

1. User chọn `townhouse` → `Tầng 1` → `phòng khách + bếp`; hệ thống chỉ hiển thị space/view/objects phù hợp.
2. User tạo góc `nhìn từ cửa vào`, ánh sáng tự nhiên; object picker cho người ngồi sofa nếu có không gian, không cho xe hơi.
3. User chuyển sang ngoại thất, góc chéo từ trái; visibility giữ hai nhà hàng xóm, không tạo hông thoáng.
4. User yêu cầu 5 ảnh chi tiết; planner chọn cửa chính, ban công, lam, vật liệu, đèn **chỉ khi được xác minh**.
5. User thêm người đi bộ và xe máy trên đường nếu có vùng đặt; có thể bật blur chuyển động cho người nhưng công trình vẫn sắc nét.
6. User Enhance theo balanced, khóa cửa và mặt tiền; chọn upscale cạnh dài 4096; QC xác nhận hình học và kích thước.
7. User tạo Concept Diagram 6 bước, chỉ dán nhãn suy luận khi chưa có mặt bằng.
8. User chọn 10 ảnh render → Concept 1 trang A3 → style Architectural Red → xuất đúng 1 trang và đủ 10 ảnh với chú thích ngắn.

## B2. Biệt thự có gara và xe cổ

1. User chọn `villa` → `sân trước/driveway` và xác nhận garage/driveway trong ảnh.
2. User chọn một mẫu xe `Mercedes-Benz 300 SL Gullwing` hoặc `Shelby/AC Cobra 289 (1964)` hay `Jaguar E-Type Series 1`.
3. Resolver kiểm tra kích thước/vùng đỗ, số xe, màu sơn, trạng thái đỗ; không ép mô hình thành gara mới.
4. Camera tiệm cận chụp xe cạnh kiến trúc, ánh sáng chiều hoặc blue hour hợp lệ; nếu xe đứng yên thì không tạo vệt sáng do xe di chuyển.
5. Sau khi QC/Enhance, user dùng Publishing Studio tạo Portfolio 8 trang, màu Warm Beige, random layout với một số trang được khóa.

# Phụ lục C — Quy ước triển khai và bàn giao

- Gói catalog V3 hiện có là dữ liệu khởi đầu; chuẩn hóa English labels, curated prompts trước merge.
- Không dùng các mã phiên bản V3–V7.2 của tính năng thay cho `ProjectDNA.schemaVersion` hay compiler version. Quản lý phiên bản **độc lập**.
- Trước mỗi đợt merge: backup SQLite dự án, branch riêng, migration test, chụp Golden Prompt snapshots, chạy test/regression.
- Không gửi bí mật API, đường dẫn local, ảnh dự án qua telemetry/log không cần thiết.
- Tài liệu này dùng làm **yêu cầu triển khai tổng hợp (master SRS)**. Các module còn phải được hiện thực và kiểm thử trước khi tuyên bố có thể dùng trong sản phẩm.
