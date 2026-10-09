# P4 integration handoff

## Đã hoàn tất

- `apps/desktop/src/lib/grade.ts` chỉ còn re-export `applyGradePixel`,
  `applyGradeToImageData` và `GRADE_LOOKS` từ `@arch/domain`; `neutralGrade` là adapter UI mỏng.
- `features/mood/variation.ts` chỉ chuyển shape asset/preset/model của UI rồi gọi
  `buildMoodVariationItems` và `adoptMoodPreset` từ domain.
- Lighting dùng `KnowledgeRegistry.lightingPresets` / `weatherPresets` và `newLightingId`.
  Mood dùng `moodPresets` / `weatherPresets` từ registry; đã bỏ fallback mood cũ.
- Bridge có `GradeApplyRequestSchema` dựa trên `ColorGradeDNASchema`; response schema
  `grade_apply` vẫn là `AssetDTOSchema`.
- Rust grade dùng exposure theo slider domain (`exposure / 100`) và đọc trực tiếp
  `packages/domain/test-vectors/grade.json`; parity pass với sai số tối đa ±1 mỗi kênh.
- Backend DNA validator áp default `enabled: true` cho artificial lights trước schema pass,
  đồng nhất với Zod default mà không thay đổi JSON đã lưu. Fixture `grade_apply` và
  `project_get` đã được regenerate.
- Đã xoá toàn bộ marker tạm của Phase 4 domain.

## Quyết định

- Giữ file vector cũ trong `apps/desktop/src-tauri/tests/grade.json` để tương thích lịch sử,
  nhưng parity test không còn fallback và sẽ fail rõ ràng nếu domain vector bị thiếu.
- Adapter mood giữ input UI tối giản để các test/mock cũ vẫn gọi được; dữ liệu pack thực tế
  đi qua `KnowledgeRegistry` và domain là nguồn hành vi duy nhất.

## Kiểm tra

- `npm.cmd run verify`: đạt; typecheck, ESLint, 307 Vitest tests, 225 Rust tests (5 ignored
  live-provider tests).
- `cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml`: đạt.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`: đạt.
- `npx.cmd prettier --check .`: đạt.
- Parity test `services::grade::tests::parity_vectors_use_domain_file_when_available`: đạt.
