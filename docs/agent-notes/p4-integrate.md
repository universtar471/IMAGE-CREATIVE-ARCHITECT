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

## Round 3

- Finding: UI mood preset fixtures/adapters assumed nested `values.mood`, while API 12.2 and
  the domain use flat mood values with optional `lighting` and `weather` partials. Change:
  updated desktop mood adoption, lock detection, weather picker handling, Contact Sheet callers,
  and tests to use the flat shape; removed the nested weather fallback. Tests:
  `returns every unlocked section changed by a preset`, `adopts all unlocked sections from the
  Mood / Grade panel and skips locked sections`, `merges direct weather preset values when its
  picker is used`, `updates lighting, weather, and mood when Contact Sheet adopts a variation`.
- Finding: Rust `ColorGrade.look` deserialization accepted JSON `null` although the Zod contract
  permits only an omitted field or string. Change: added non-null string deserialization and a
  validation regression test, `services::grade::tests::rejects_grade_apply_request_with_null_look`.
- Commands: `npm.cmd run verify` (321 Vitest; 227 Rust passed, 5 ignored),
  `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check`,
  `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings`,
  and `npx.cmd prettier --check .` all passed.
