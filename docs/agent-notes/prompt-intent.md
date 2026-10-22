# wt/prompt-intent

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-22 23:38

## Muc tieu

Sửa Cải thiện prompt bị kéo theo DNA Japandi/beige dù người dùng nhập phòng khách biệt thự hiện đại, đen trắng chủ đạo.

## Da xong

- Chỉ dẫn AI ưu tiên mọi yêu cầu rõ ràng của người dùng, bao gồm loại phòng/công trình, phong cách, màu chủ đạo, vật liệu, ánh sáng và yêu cầu loại trừ.
- DNA là ngữ cảnh phụ, chỉ dùng khi tương thích; bỏ chi tiết mâu thuẫn thay vì trộn hai phong cách/bảng màu.
- Giữ ngôn ngữ người dùng; thêm chi tiết vừa đủ và kiểm tra không bỏ sót yêu cầu trước khi trả lời.
- Sửa lỗi gợi ý cũ vẫn có thể được nhận sau khi người dùng sửa prompt.
- Đồng bộ tooltip, mock backend và API_CONTRACTS; không đổi schema hay dữ liệu dự án.
- Hai regression test đã được chạy đỏ trước khi sửa: thứ tự ưu tiên prompt/DNA và bỏ preview cũ khi thay đổi prompt.

## Con no

- Chưa merge main, chưa tạo bộ cài mới cho sửa này. Bộ cài bàn giao ở lượt trước chưa chứa thay đổi này.
- Chưa gọi HHTECH thực tế; test kiểm tra yêu cầu gửi model và hành vi giao diện, không khẳng định mọi model luôn tuân thủ ngữ nghĩa.

## Lenh test

- `npm test -- --maxWorkers=2 --testTimeout=15000 --reporter=dot`: 109 files, 1182 tests passed.
- Sau khi đồng bộ mock, chạy lại `npm test -- apps/desktop/tests/extraPrompt.test.tsx --maxWorkers=2 --reporter=dot`: 8 passed.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --jobs 2 -- --test-threads=2`: 370 passed, 6 live tests ignored; main/doctests passed.
- `npm run typecheck`, `npm run lint`, `npm run build -w @arch/desktop`: passed.
- `rustfmt --edition 2021 --check apps/desktop/src-tauri/src/services/prompt_enhance.rs` và `git diff --check`: passed.

## Cam bay da gap

- Không giữ quy tắc cũ “preserve every fact of DNA”: chính nó tạo xung đột với prompt tự nhập. Không chỉ sửa mock hoặc UI.
- Provider test double trả về dòng cuối user message. Giữ prompt người dùng cuối message và đánh nhãn highest priority; ghi DNA trước với nhãn lower priority.
- Frontend build có cảnh báo bundle >500 kB từ trước, không chặn build.

## Bổ sung 2026-10-23: camera và Bối cảnh trong Không gian

- Tái hiện góc cận vẫn có Camera góc rộng mặc định, các view front/pedestrian/room corner trả camera ngoại thất, và render-conversion preset có thể giữ nguyên góc nguồn trong biến thể.
- Prompt compiler dùng camera tạm xác định từ shot intent xuyên suốt subject/camera/site framing. Giữ Camera Director khi yêu cầu cameraId cụ thể; id tạm không đi vào cameraId lưu trữ/provenance. Preset Sources vẫn ghi nguồn lựa chọn; mỗi prompt chỉ có một mô tả Camera.
- Bộ camera Nội thất: Chính diện phòng, Góc phòng, Tầm mắt, Toàn phòng, Từ cửa vào, Cận nội thất. Cùng label/catalog cho Generate và Camera; Node dùng scope snapshot để hiện nhãn tương ứng. Giữ id camera cũ, không migration.
- Nút Camera và chip preset đồng bộ, giữ purpose/focus. Camera editor trong phòng không đề xuất preset/loại ngoại thất mới; camera cũ vẫn đọc/sửa được.
- Khi compile biến thể, bỏ render preset giữ góc gốc; chỉ dẫn nguồn cho phép reframe/close-up. Role hint của structure sketch tôn trọng chỉ dẫn viewpoint/framing trong prompt. Hero/sketch conversion vẫn có chỉ dẫn giữ góc nguồn.
- Thời tiết Nội thất chuyển thành ánh sáng/cảnh ngoài cửa, không mưa/sương/sàn ướt trong phòng.
- Bối cảnh nằm trong Không gian: Thành phố, Sân vườn, Cảnh núi, Cảnh biển, Đồng quê, Rừng cây. Dùng context.macroContext/front.spaceType hiện có; giữ site evidence, custom fields và dữ liệu cũ. Controls nâng cao + xác nhận workflow trong Chi tiết bối cảnh; chỉ mount khi mở, giữ mounted sau đó.
- Chưa merge main/chưa tạo bộ cài mới. Nhánh vẫn chứa cả sửa prompt commit 075ed84.
- Kiểm tra: frontend/domain 111 files / 1201 tests passed; Rust 370 passed, 6 live ignored; typecheck/lint/build frontend và browser QA mô phỏng. Không gọi AI thật trả phí.
- Rà cuối phát hiện front/approach dùng chung composition; đã tách approach thành góc từ cửa vào với khung cửa và lối di chuyển. Test bổ sung xác nhận sáu composition Nội thất khác nhau.
- Browser QA đã kiểm tra chọn icon biển, ẩn menu Context riêng, chọn Cận nội thất và compile đúng close-up (không còn góc rộng mặc định). Ảnh minh họa và kết quả QA nằm trong outputs của chat: space-context-icons.png, interior-camera-controls.png, camera-context-qa.json.
- Lệnh: `npm test -- --maxWorkers=2 --testTimeout=15000 --reporter=dot`; `npm run typecheck`; `npm run lint`; `npm run build -w @arch/desktop`; `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --jobs 2 -- --test-threads=2`.
