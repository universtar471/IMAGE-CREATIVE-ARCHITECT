# Bàn giao `wt/p4-domain`

## Mục tiêu

Hoàn thiện domain Phase 4: DNA lighting/weather/mood, knowledge packs 1.2.0, compiler `pc-1.2.0`, mood variations và grade math; giữ tương thích dữ liệu Phase 1–3.

## Đã làm

- Mở rộng schema trong `packages/domain/src/schemas/future.ts` và `projectDna.ts`: `presetId`, artificial light `id`/`enabled`, vocabulary constants, `LockState.mood`; thêm `newLightingId` trong `src/ids.ts`.
- Thêm `lightingPresets`, `weatherPresets`, `moodPresets` vào mọi `knowledge/**/pack.json` (pack version `1.2.0`), schema và resolution methods trong `src/knowledge/registry.ts`.
- Compiler `src/prompt/compiler.ts` lên `pc-1.2.0`, tách section Lighting/Weather/Mood theo thứ tự Context -> Lighting -> Weather -> Mood -> Camera, render artificial lights, lock preservation và `compileWithOverrides`.
- Thêm `buildMoodVariationItems`, giới hạn reference rõ ràng và `adoptMoodPreset` trong `src/generation/batch.ts`.
- Thêm grade pipeline thuần trong `src/grade/apply.ts`, built-in `GRADE_LOOKS`, generator `src/grade/vectors.ts`, script `grade:vectors` và `test-vectors/grade.json` (identity + 12 slider families + 6 looks trên 16 màu).
- Tái sinh `packages/domain/schema/project-dna.schema.json`; generator giữ `locks.mood` optional trong JSON Schema để DNA cũ thiếu field vẫn qua Rust validation, trong khi Zod default là `false`.
- Thêm `packages/domain/tests/phase4.test.ts` và cập nhật compiler snapshot version.

## Quyết định

- Artificial-light `id` để optional trong schema nhằm không phá fixture cũ; UI/backend tạo id mới bằng `newLightingId()` và id hợp lệ có dạng `LGT_<ULID>`.
- `compileWithOverrides` nhận cả `PromptCompileInput` và `ProjectDNA`; overload DNA dùng project custom tối thiểu để tiện mood variation.
- Preset mood trực tiếp ghi `mood`; nếu values có nested `lighting`/`weather`/`mood` thì builder/adopter xử lý cả ba section và tôn trọng từng lock.
- Chuẩn hóa `ColorGradeDNA.exposure` về miền -100..100 như các slider còn lại; pipeline dùng `exposure / 100` trong `2^k`, nên vectors cover đúng ±100/±50 và vẫn khớp contract.

## Còn lại

- Không còn việc domain nào trong brief. P4-B/P4-C cần merge branch này để dùng schema, compiler và grade vectors.

## Lệnh kiểm tra và kết quả

- `npm.cmd run typecheck -w @arch/domain` — PASS.
- `npm.cmd test -- --run packages/domain/tests` — PASS (123 tests).
- `npm.cmd run verify` — PASS (301 Vitest tests; Rust 219 passed, 5 ignored).
- `cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml` — PASS.
- `npx.cmd prettier --check .` — PASS.
- `npm.cmd run schema:export` và `npm.cmd run grade:vectors` không chạy được trực tiếp vì môi trường Node báo `uv_os_get_passwd returned ENOMEM`; đã dùng TypeScript compiler CommonJS trong thư mục temp để tái sinh schema/vectors, rồi kiểm tra JSON/schema qua test và verify.

## Cạm bẫy

- Không đọc `.env` và không gọi provider/network.
- `npm` PowerShell bị execution policy; dùng `npm.cmd`.
- JSON Schema của Zod đánh dấu mọi default field required; riêng `locks.mood` được lọc khỏi `required` để dữ liệu cũ không bị Rust từ chối.
