# Bàn giao menu-ai-unification

- Nhánh: `wt/menu-ai-unification`
- Repo gốc: `D:/IMAGE-CREATIVE-ARCHITECT-github`, base `31699f7`.
- Worktree Codex: `D:/worktrees/IMAGE-CREATIVE-ARCHITECT-github/menu-ai-unification`.
- Không sửa repo chính hoặc worktree khác. Chưa push, merge hay thay bản ứng dụng đang cài.

## Mục tiêu và kiến trúc đã kiểm tra

Ứng dụng Tauri 2, React/TypeScript + Vite, Zustand, Zod; SQLite qua typed Tauri bridge/Rust repositories. Hai mode dùng chung ProjectWorkspace/PropertyPanel/WorkspaceNav và BottomTray. Đã đọc ba ảnh trong cuộc trò chuyện gốc. Bản `D:/IMAGE-CREATIVE-ARCHITECT` khác có lịch sử local cũ hơn; không tự đồng bộ hai repo.

## Đã thực hiện

- **P0:** tái hiện bằng regression test lỗi backend trả `usage: null` khiến bridge Zod từ chối phản hồi AI hợp lệ. Sửa hợp đồng nullish. Chuẩn hóa catalog/parser/normalize/apply dùng chung cho Building, Interior, Context, Lighting, Style, Camera, Mood, Rooms, Regions, Effects. JSON fenced/wrapped, trailing comma bên ngoài string, nested partial DNA, số dạng chuỗi, tên enum, phần tử array không hợp lệ, missing field, duplicate/unknown path đều được xử lý có giới hạn. Field không xác định bị loại; giữ giá trị hiện tại thay vì tự đoán. Apply qua ProjectDNASchema, tôn trọng locks và mở lại bước đã xác nhận khi người dùng đồng ý. Sửa nhầm schema ánh sáng Nội thất và room validation dùng đúng building use hiện tại. Phân biệt lỗi API key với quota, loading/error/retry dùng chung.
- **P1:** tạo dự án chỉ còn tên và Nội thất/Công trình; Công trình mới dùng type `custom` có sẵn, type dự án cũ được giữ. Tạo xong vào Không gian/Architecture. Icon-first nav ở mọi kích thước. Style grid 2 cột, thumbnail 96px, xem lớn rồi Apply. Ảnh tham chiếu nhập/quản lý trong Không gian. Không còn surface-material editor trong Không gian. Chỉnh vùng chọn mask trước khi chọn vật liệu. Bỏ mục scene objects khỏi nav, giữ dữ liệu/routing cũ để tương thích.
- **P2:** Rooms gồm loại phòng hợp lệ theo building use, icon và các thành phần gợi ý; giữ chỉnh mật độ. Add to Prompt nối thêm vào prompt hiện tại; Add to Node nối bản nháp vào ảnh được chọn, không tự chạy generation. Có action Person/Animal/Tree/Decor/Effect trong Chỉnh vùng; chọn action chuyển canvas sang công cụ vẽ vùng. Đồng bộ selection giữa canvas và inspector; đổi ảnh remount vùng để tránh dùng mask cũ. HelpPopover thay guide mở thường trực; preview màu không còn illustration ngôi nhà, dùng ảnh thật/empty state. Giữ live grade preview trước Apply đang có sẵn.
- **P3:** AI nhận draft DNA, mode/module, ảnh hiện tại, ảnh tham chiếu, camera, selections và vùng khi liên quan. Gợi ý reference có style/palette/lighting/mood/camera, các field được precheck để người dùng xem và Apply. Không tự ghi đề xuất vào dự án trước Apply.

## File/component chính

- `packages/domain/src/assist/index.ts`: catalog, JSON recovery, normalize, validation, immutable apply.
- `apps/desktop/src/lib/assist.ts`, `lib/bridge.ts`, Rust `src-tauri/src/services/dna_assist.rs`: request pipeline và hợp đồng phản hồi/context.
- `features/assist/AssistControl.tsx`, `ModuleAssist.tsx`: UI loading/errors/retry/checked proposal chung.
- `features/projects/NewProjectWizard.tsx`, `ProjectHub.tsx`: luồng tạo dự án mới.
- `features/style/StylePanel.tsx`, `features/rooms/RoomsPanel.tsx`, `features/assets/SpaceReferences.tsx`: các module trên shell chung.
- `features/dna/*`, `features/lighting/*`, `features/regions/*`, `features/effects/*`, `features/previews/GradePreview.tsx`: các adapter và tương tác theo ngữ cảnh.
- `components/shell/WorkspaceNav.tsx`, `components/panels/PropertyPanel.tsx`, `features/workspace/*`, `styles/responsive.css`, `i18n/en.ts`, `vi.ts`.
- Quyết định kiến trúc: ADR-049 trong `docs/DECISIONS.md`.

## Dữ liệu và tương thích

Không đổi version DNA/database, không migration. Không xóa Node/Prompt/History/assets hoặc project data. Surface/furniture selections cũ vẫn được giữ trong DNA; chỉ thay khi người dùng Apply/chọn hành động tương ứng. Scene graph cũ còn trong phần nâng cao Chỉnh vùng và các route nội bộ. Image analysis evidence board (scope analysis) là tác vụ khác, giữ parser chuyên biệt và hưởng bản sửa null usage ở bridge.

## Kiểm chứng

- Regression test `assistContract.test.ts` đã fail với bản cũ, pass sau sửa null usage.
- Test auth/quota Rust đã fail với mapping cũ, pass sau sửa.
- Toàn bộ frontend/domain sau thay đổi cuối: 109 file test, 1.181 test pass (64,69 giây). Lỗi regression context.vegetation sau khi tách catalog Nội thất đã được sửa bằng whitelist tương thích, không nới catalog gợi ý.
- Toàn bộ Rust lib trước thay đổi phân loại auth: 368 pass, 6 live tests ignored. Sau thay đổi auth: cả 3 test dna_assist pass.
- Lint, typecheck và frontend production build đã pass cho trạng thái bàn giao.
- Kiểm tra browser mock: form hai lựa chọn, tạo Interior vào Không gian, sidebar icon, Style 2 cột và ảnh thumbnail tải đúng. Ảnh kiểm tra lưu trong outputs của chat.

Lệnh:

```powershell
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm test -- --maxWorkers=2 --testTimeout=15000
npm run build -w @arch/desktop
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib -j 2
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib dna_assist -j 2
```

## Giới hạn/cạm bẫy

- Chưa gọi API AI trả phí thực tế và chưa build/install bộ cài Tauri; không dùng key hoặc .env thật để QA. Chất lượng gợi ý vision thực tế cần kiểm tra với provider đang dùng.
- Thumbnail architecture thiếu ảnh phù hợp sẽ dùng placeholder có tên; không dùng ảnh nội thất để minh họa công trình. Có thể bổ sung manifest `style_architecture` sau.
- Build vẫn có cảnh báo bundle lớn hơn 500kB; không chặn build.
- Chạy quá nhiều Vitest worker đồng thời với compile Rust lần đầu gây timeout do tài nguyên; `--maxWorkers=2` chạy xanh. Sáu test Rust live mặc định ignored để không gọi dịch vụ trả phí.
- Node draft của hệ thống là một draft generation gắn ảnh nguồn; Add to Node dùng cơ chế này và giữ history/graph lineage hiện có.
