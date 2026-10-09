# wt/p3-fixes

- Agent: claude
- Tách từ: main (1fe6b7e)
- Ngày: 2026-10-09

## Mục tiêu

Sửa các phát hiện của review Codex vòng 1 cho Phase 3
(`docs/agent-reviews/p3-domain.md`, `p3-backend.md`, `p3-ui.md`): toàn bộ PHẢI SỬA và các
NÊN SỬA rẻ. Mỗi lỗi có test tái hiện (đỏ) trước khi sửa.

## Đã xong

### PHẢI SỬA

1. **Domain — batch production bỏ anchor** (`p3-domain`)
   - `packages/domain/src/generation/batch.ts`: thêm `BatchReferenceLimitError`;
     `buildProductionBatchItems` ném lỗi khi master + anchor (bắt buộc) vượt
     `maxReferenceImages` (hoặc model không có image-to-image → cap 0). Extras vẫn bị cắt cho
     vừa cap (hành vi cũ, đã ghi trong JSDoc). Batch anchor giữ nguyên hành vi cũ.
   - `apps/desktop/src/features/camera/batch.ts`: `planBatch` bắt lỗi đó → issue chặn
     ("… Choose another model."), `items = []`, `request = null`; `BatchDialog` đã hiển thị
     `issues[0]` và khoá nút Queue.
   - Test: `packages/domain/tests/batch.test.ts` ("fails instead of dropping the anchor…"),
     `apps/desktop/tests/camera.test.ts` ("asks for another model…").
2. **Backend — spawn thread lỗi** (`p3-backend`)
   - `apps/desktop/src-tauri/src/services/queue.rs`: `start_claims` (spawn được tiêm vào để
     test). Spawn lỗi → job `failed` (error kind `interrupted`, `retryable: true`, message có
     lỗi OS), giải phóng slot (`SlotGuard`), đánh thức dispatcher, phát event.
   - Kèm NÊN SỬA panic: `run` bọc `run_job` trong `catch_unwind`; panic → attempt thất bại với
     message panic → job/generation `failed` + event, không kẹt `running`.
   - Test: `a_job_thread_that_cannot_start_fails_the_job_and_frees_its_slot`,
     `a_panicking_attempt_fails_the_job_and_frees_its_slot` (thay test cũ khẳng định job kẹt
     `running`).
3. **Backend — camera bị xoá giữa validate và insert** (`p3-backend`)
   - `services/generations.rs::insert_queued` kiểm tra lại `cameraId` với DNA hiện tại trong
     transaction (cùng chỗ kiểm tra project/reference). `services/batches.rs::create`: lỗi
     insert bất kỳ item nào rollback cả batch; lỗi mang tiền tố `Item N ('label')` +
     `details.itemIndex` như lỗi validate (hàm `item_error` dùng chung). Hook test
     `AFTER_PREPARE` giờ chạy cả trong `batch_create`.
   - Test: `generations::camera_removed_before_insert_is_rejected_without_a_row`,
     `batches::camera_removed_after_validation_rejects_the_whole_batch`.
4. **UI — poll cũ ghi đè trạng thái mới** (`p3-ui`)
   - `apps/desktop/src/app/store.ts`: token request cho `job_list`/`generation_list` (bỏ trả lời
     của poll cũ khi đã có poll mới hơn) + `mergePolled`: item được cập nhật từ event/kết quả
     command sau khi poll bắt đầu (`syncSeq`/`jobSeenAt`/`generationSeenAt`) giữ giá trị hiện
     tại; item đã kết thúc không bao giờ quay về trạng thái active.
   - Test (`apps/desktop/tests/queue.test.ts`, describe "stale polls never overwrite newer
     state"): giữ response bằng `deferredTransport` (thêm `releaseNewest` trong
     `tests/helpers.ts`) để ép thứ tự: event `completed` trước khi poll cũ trả về; poll mới trả
     về trước poll cũ (cho cả jobs và generations).

### Review vòng 2 (`docs/agent-reviews/p3-fixes.md` trên main)

- PHẢI SỬA: `store.ts` `submitGeneration` và `retryGeneration` thêm generation từ kết quả
  command mà không ghi `generationSeenAt` → một `generation_list` gửi trước đó, trả về sau,
  có thể xoá nó khỏi store khi không có event. Nay cả hai ghi `generationSeenAt` (như event).
  Các đường khác: `job_cancel`/`job_retry` đi qua `applyJobEvent` (đã ghi `jobSeenAt`);
  `createBatch` gọi `refreshGenerations` mới (token mới loại poll cũ), job của batch đến qua
  `refreshJobs`. Test: "a poll sent before submit or retry does not drop the returned
  generation" trong `apps/desktop/tests/queue.test.ts`.
- NÊN SỬA: `docs/API_CONTRACTS.md` §10 (sau danh sách `kind`) ghi rõ `failed` + kind
  `interrupted` khi thread không khởi động được hoặc attempt panic.

### NÊN SỬA đã làm

- `packages/domain/src/schemas/future.ts`: regex `CAM_` đổi thành `^CAM_[0-7][0-9A-HJKMNP-TV-Z]{25}$`;
  regenerate `packages/domain/schema/project-dna.schema.json` bằng `npm run schema:export`
  (backend `dna_validation.rs` include file này). Các id test (`CAM_01J…`) vẫn hợp lệ.
- `queue.rs`: dispatcher chỉ chờ retry *chưa đến hạn* tại lần claim gần nhất
  (`repo::next_retry_after`); retry quá hạn mà slot bận chờ wake khi slot giải phóng (tối đa
  `IDLE_RECHECK` 30 s), hết busy-poll 10 ms. Test
  `an_overdue_retry_waiting_for_a_slot_does_not_busy_poll`.
- `queue.rs` test concurrency: thay `sleep(150ms)` bằng `Gate` (Mutex + Condvar) giữ các call
  trong provider double; kiểm tra đúng 2 local + 1 remote cùng lúc, phần còn lại `queued`.
- `apps/desktop/src/lib/bridge.ts`: unsubscribe cuối cùng gọi `disconnectEvents()`; kết nối mở
  xong sau khi đã disconnect/không còn subscriber thì tự đóng (`connectionEpoch`);
  unsubscribe lặp lại là no-op. Test describe "bridge event connection" trong `queue.test.ts`.

## Còn nợ / bỏ qua

- Không đổi DTO/fixture backend (`contract_fixtures` vẫn xanh, không cần regenerate).
- Panic trong lúc đang giữ DB lock vẫn làm poison mutex (`AppCore::conn` trả `DbError`);
  provider call (nơi dễ panic nhất) chạy ngoài lock nên trường hợp này hiếm. Chưa xử lý.
- File output đã ghi ra đĩa trước một panic (trước commit) không được dọn.

## Lệnh test

```
npm ci                                   # worktree mới chưa có node_modules
npm run verify                           # typecheck + lint + vitest + cargo test (đã xanh: 248 TS, 139 Rust)
npm run format:check
cd apps/desktop/src-tauri; cargo fmt --check
npx vitest run packages/domain/tests/batch.test.ts apps/desktop/tests/queue.test.ts apps/desktop/tests/camera.test.ts
cd apps/desktop/src-tauri; cargo test --lib queue; cargo test --lib camera_removed
```

## Cạm bẫy đã gặp

- Test Phase 2 `running_generation_becomes_interrupted_on_reopen` giả lập app chết bằng
  provider panic; sau khi bắt panic thì phải giả lập bằng `queue::claim` rồi bỏ claim.
- `deferredTransport` chạy lệnh mock ngay (snapshot lúc gửi) và chỉ giữ response; khi giữ
  `generation_list`, `refreshJobs` có thể treo vì nhánh "missed" gọi `refreshGenerations`
  — test jobs và generations tách riêng.
- `waitFor` trong `tests/helpers.ts` không hỗ trợ điều kiện async (Promise luôn truthy).
- `prettier --write docs/API_CONTRACTS.md` đổi định dạng khoảng 90 dòng không liên quan
  (bảng, xuống dòng) — sửa file này bằng tay, không chạy prettier trực tiếp.
