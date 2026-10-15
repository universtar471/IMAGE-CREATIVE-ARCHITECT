# wt/srs-p1c

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-16 03:13

## Mục tiêu

Triển khai Context Library V4 như lớp gợi ý thuần domain theo ADR-034 amendment 1 và amendment 2.

## Đã xong

- Thêm `tools/context-library/convert.ts`, `label-en.json` và script `context:build`.
- Converter chỉ nhập `townhouse`, `villa`, `apartment`, `hotel`, `resort` (53 preset), giữ 12 vùng, dựng lại `englishPrompt` từ trường có cấu trúc và chặn English non-ASCII/Vietnamese.
- Sinh `knowledge/context-library/library.json` ổn định, có nhãn Việt có dấu và nhãn English sạch.
- Thêm `packages/domain/src/contextLibrary/` (Zod schema, registry, `CONTEXT_LIBRARY_VERSION = cl-4.0.0`, `contextSuggestionsFor`, `suggestContext`) và export từ domain index.
- `suggestContext` lọc cue party-wall/attached khi cạnh là street/open_space, lọc lawn/grounds khi cạnh attached, trả `droppedForEvidence`, region details/avoid và không mutate DNA.
- Thêm 4 test domain cho converter, registry, deterministic output, evidence precedence và `unspecified`.

## Hình dạng đã chọn và còn nợ

- `library.json` dùng `{ libraryVersion, sourceVersion, buildingTypes[], regions[], presets[] }`; region giữ `name` tiếng Việt và `nameEn` tiếng Anh.
- `contextSuggestionsFor` trả danh sách preset theo archetype; region là overlay độc lập. `suggestContext` trả sáu mảng theo brief.
- Chưa nối suggestion layer vào compiler hoặc UI (đúng out-of-scope P1c; chờ P1b).
- Contradiction hiện là heuristic từ khóa có kiểm soát, không phải semantic/NLP; site evidence vẫn là nguồn ưu tiên.
- `context:build` dùng Node 24 `--experimental-strip-types` để tránh lỗi môi trường `tsx`/`uv_os_get_passwd`; không gọi mạng.

## Lệnh test

- `npx.cmd vitest run packages/domain/tests/context-library.test.ts` — 4/4.
- `npm.cmd run typecheck`, `npm.cmd run lint` — đạt.
- `npm.cmd test` — 64 file, 708 test đạt.
- `cargo test --offline --manifest-path apps/desktop/src-tauri/Cargo.toml` — 286 đạt, 6 ignored (smoke provider).
- `npm.cmd run verify` — đạt.
- `npx.cmd prettier --check .` — đạt.

## Cạm bẫy

- Không sửa Rust, không đọc/sửa `.env`, không commit/push.

