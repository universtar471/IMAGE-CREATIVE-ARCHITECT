# Kế hoạch phát triển IMAGE-CREATIVE-ARCHITECT theo hướng VizMaker (giai đoạn Ảnh)

## Bối cảnh

- **Nguồn:** phiên "Phân tích và tích hợp Vizmaker" (2026-10-19). Trong phiên đó bạn đã gửi giao diện VizMaker và các báo cáo Codex/REA, đọc trọn 3 trang transcript.
- **Mục tiêu:** đổi cách dùng app từ "đi qua 9 hạng mục và 5 bước DNA" sang kiểu VizMaker: ảnh nguồn → bấm preset → Tạo. Sau đó thêm canvas node.
- **Ưu thế giữ lại:** lõi DNA, validator, lineage và evidence. Đây là chỗ app hơn VizMaker.

**Đã chốt với bạn:**
1. Làm phần ảnh trước. Video, 3D Meshy và account làm sau (giai đoạn B).
2. **Tạo nhanh:** chỉ cần ảnh nguồn và preset, không phải xác nhận đủ 5 bước DNA. Anchor và batch vẫn giữ khóa.
3. Preset giờ/thời tiết chỉ áp cho lượt tạo đó (ShotIntent), không ghi vào DNA.
4. **Preset tự viết, không chép VizMaker.** Không giải mã `.vm`, không chép nguyên văn prompt. Học qua bảng đặc tính quan sát và so sánh A/B có chấm điểm.

**Hiện trạng repo:**
- Repo ở ADR-038, đã xong SRS P0–P5 (Effects, Scene objects, Visual intent, Diagram, Publishing).
- `ShotIntent` (`packages/domain/src/validation/shotIntent.ts`) đã chứa `visualIntent`, `effects` và `sceneObjects`. Đây là đích ghi của preset.

## Giai đoạn A — Ảnh và Node

### M1 — Preset là trung tâm (~2–2,5 tuần; 4–6 ngày nếu chạy 4–5 agent)

| # | Việc | File chính | Dùng lại |
|---|---|---|---|
| A0 | ADR-039: Preset Studio, Tạo nhanh, ShotIntent mở rộng; hợp đồng schema preset | `docs/DECISIONS.md`, `docs/agent-tasks/m1-*.md` | — |
| A1 | Thư viện preset: 30–40 preset song ngữ, 7 nhóm (Render, Giờ và ánh sáng, Thời tiết, Góc máy, Người và xe, Hiệu ứng, Look màu). Mỗi preset gồm `id`, `group`, `exclusiveGroup`, `shotPatch` (phần ghi vào ShotIntent), `promptEn` kèm điều kiện "giữ gì" và `source`. Thêm `lighting {timeOfDay, weather}` theo lượt vào ShotIntent. Thêm section compiler `PRESETS` có nguồn từng đoạn, nâng `pc-1.10.0`. Thêm rule validator | `packages/domain/src/presets/{schemas,catalog,apply}.ts`, `knowledge/presets/catalog.json`, `validation/shotIntent.ts`, `prompt/compiler.ts` | `EFFECT_CATALOG` (`effects/catalog.ts`), `SCENE_OBJECT_PRESETS` (`sceneObjects/catalog.ts`), `camera/intent.ts`, `TimeOfDaySchema` (`schemas/future.ts`), looks trong `grade/` |
| A2 | Lưới preset và chip: bấm là thêm chip; chống trùng; preset cùng `exclusiveGroup` tự thay nhau; prompt preview hiện nguồn từng đoạn | `apps/desktop/src/features/presets/{PresetGrid,PresetChips}.tsx`, `lib/store.ts` | `GeneratePromptPreview.tsx` |
| A3 | Gộp Effects, Scene objects, Visual intent và Lighting theo lượt vào các nhóm preset; module cũ chuyển sang "Nâng cao" | `features/effects/EffectsPanel.tsx`, `features/sceneObjects/SceneObjectsPanel.tsx`, `features/camera/VisualIntentSelector.tsx` | các panel hiện có |
| A4 | Tạo nhanh: thêm nhánh `quick` trong `isGenerationAllowed`. Rust chấp nhận yêu cầu `quick` có ảnh nguồn; validator BLOCK vẫn chặn | `packages/domain/src/workflow/workflow.ts`, `features/workflow/blockedReason.ts`, `src-tauri/src/services/generations.rs` | `validateShot`, gate chi phí |
| A5 | Gọn `GeneratePanel.tsx` (782 dòng). Chế độ Đơn giản: Nguồn → Preset → Prompt → Tạo, kèm chi phí ước tính. Chế độ Nâng cao: provider, kích thước, số ảnh, tham chiếu, seed, với mặc định thông minh. Chế độ nhớ trong localStorage | `features/generate/GeneratePanel.tsx` (tách thành `SimpleGenerate.tsx` và `AdvancedGenerate.tsx`) | `QualityField`, `ExtraPromptSection` |
| A6 | Gom 15 module thành các nhóm Studio / DNA / Hậu kỳ / Xuất bản | `features/workspace/modules.ts`, left nav | `availableIn` |

**Kết quả M1:** mở dự án, chọn ảnh nguồn, bấm 2–3 preset, nhấn Tạo; không cần đi qua 5 bước DNA.

### M2 — Tiện ích đầu vào (~1–1,5 tuần)

- **A7 My presets:**
  - migration `0010_user_presets.sql`;
  - CRUD bằng `blocking()` commands, kèm contract fixtures;
  - nút "Lưu tổ hợp chip thành preset".
- **A12 SketchUp → app:**
  - extension Ruby gọi `view.write_image` để ghi PNG kèm JSON (scene, model, kích thước) vào thư mục chờ;
  - lệnh Rust liệt kê và nhập ảnh vào thư mục `inbox`, thành asset nguồn `sketchup`, vai trò `structure_sketch`;
  - chống trùng bằng SHA-256 (đã có trong khâu import); không tự chạy model.
- **A13 Gateway tương thích OpenAI** (nếu BEAR có `/v1/images/*`):
  - tổng quát hóa adapter HHTECH thành provider gateway cấu hình được;
  - key nằm trong kho mật khẩu của hệ điều hành;
  - ước tính 1–2 ngày.

### M3 — Canvas node (~3–4 tuần)

- **A8 Canvas node** trên React Flow (MIT):
  - node Nguồn → node Preset/Recipe → node Kết quả;
  - cổng có kiểu media; chặn nối vòng; phân nhánh;
  - bảng `recipe_graphs` và `recipe_runs`, mỗi lượt chạy là bản ghi cố định;
  - chỉ chạy lại node bị đổi; ghép template không tự tiêu credit.
- **A9** Thanh trượt so sánh A/B; menu node có sao chép prompt, nhân bản node, lưu asset. Chọn node thì thanh prompt và preview ở đáy đổi theo.

### M4 — Recipe ảnh (~2–3 tuần)

- **A10 Recipe biến thể:**
  - 6 kịch bản ánh sáng, phối màu, moodboard vật liệu, đổi phong cách;
  - mặc định dùng ảnh đã duyệt làm nguồn chuẩn; cảnh báo khi người dùng nối tiếp ảnh → ảnh.
- **A11 Bảng phân tích có chứng cứ:**
  - model thị giác trả JSON;
  - app tự dựng bảng SVG với chữ sắc nét (dùng lại `dna_assist`, `diagram/` và `publishing/`);
  - nhãn `inferred` thay cho điểm số giả.

### Song song: chất lượng preset

- Tạo `docs/presets/PRESET_OBSERVATIONS.md`, gồm bảng đặc tính và thang chấm A/B 1–5 theo năm tiêu chí: hình học, vật liệu, ánh sáng, lỗi lạ, đúng ý.
- Bạn điền bảng khi dùng VizMaker. Mình chỉnh `knowledge/presets/catalog.json`; chỉ sửa dữ liệu, không đụng code.
- Mỗi vòng A/B khoảng 120–180 ảnh, chạy ở 1K để rẻ.

## Giai đoạn B — Sau khi xong phần ảnh

| Việc | Ước tính |
|---|---|
| Ảnh → video AI (`media_kind`, job bất đồng bộ, adapter fal/Replicate/Comfy) | 2–3 tuần |
| Ghép clip và trim bằng FFmpeg | 1–2 tuần |
| SketchUp → video sang video | 2–3 tuần |
| Meshy 3D, xem GLB | 2–3 tuần |
| Account, credit | 6–10 tuần trở lên, chỉ làm khi bán |

## Chi phí ước tính

- **Token (Claude Code):** khoảng 5–15 triệu token đọc vào cho mỗi ngày công, 85–95% là cache.

  | Mốc | Token đọc vào |
  |---|---|
  | M1 | 60–200 triệu |
  | M2 | 30–110 triệu |
  | M3 | 70–260 triệu |
  | M4 | 50–180 triệu |
  | **Tổng giai đoạn A** | **250–900 triệu** (viết ra khoảng 3–10 triệu) |

- **API ảnh:** theo `priceHint` của HHTECH, khoảng 180–900đ/ảnh. Phân tích A11 chỉ tốn token văn bản, rất rẻ.
- **Chia 5 agent cho M1, mỗi agent một worktree `wt/m1-*`:**

  | Agent | Việc |
  |---|---|
  | Lead | A0, merge |
  | Domain | A1 |
  | UI | A2 + A3, bắt đầu sau hợp đồng A0 |
  | Workflow/Panel | A4 + A5 + A6 |
  | Review | Codex qua HHTECH |

- **Điểm hay xung đột:** `store.ts`, `bridge.ts`, `mockBackend.ts`, i18n, `GeneratePanel.tsx`. Lead chốt trước phần khai báo kiểu cho các file này.

## Rủi ro

- **Nối ảnh → ảnh nhiều lần làm lệch thiết kế:** mặc định lấy ảnh đã duyệt làm nguồn.
- **Preset không được ghi vào DNA:** có test chặn việc này.
- **Dự án cũ phải mở được:** ShotIntent mở rộng là optional, có roundtrip test.
- **Gói 24h của BEAR:** phải có định dạng Messages API của Anthropic, prompt caching và ít nhất 5 phiên đồng thời. Chạy thử 1–2 giờ trước khi chạy cả ngày.

## Kiểm tra

- Mỗi mốc chạy `npm run verify`: typecheck, lint, Vitest và `cargo test`; thêm `cargo clippy -D warnings`.
- Sau mỗi thay đổi DTO, cập nhật contract fixtures (`UPDATE_BACKEND_FIXTURES=1`).
- **Test mới:**
  - preset loại trừ nhau thay nhau;
  - compiler xác định (cùng đầu vào cho cùng đầu ra) và ghi nguồn section;
  - Tạo nhanh qua được khi chưa xác nhận DNA, nhưng anchor/batch vẫn bị khóa;
  - preset không ghi vào DNA;
  - roundtrip DNA cũ;
  - `hardcodedStrings` cho i18n.
- **Thủ công:**
  - `npm run dev` trên trình duyệt với mock backend: ảnh nguồn → 3 preset → Tạo bằng `local_preview` (miễn phí);
  - bạn thử trên Tauri Windows với HHTECH 1K.
- **M2:** gửi viewport từ SketchUp 2 lần thì chỉ có 1 asset.

## Bước đầu tiên khi được duyệt

Clone lại repo với quyền push, tạo nhánh làm việc, rồi viết ADR-039, hợp đồng schema preset và brief `docs/agent-tasks/m1-*.md`. Sau đó làm A1.
