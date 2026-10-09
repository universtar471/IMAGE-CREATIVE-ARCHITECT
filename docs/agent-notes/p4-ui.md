# wt/p4-ui

- Agent: codex
- Branch: wt/p4-ui (no commit; working tree is intentionally left for lead)
- Scope: apps/desktop/src/** and apps/desktop/tests/** (excluding backend fixtures)

## Muc tieu

Hoan thien UI Phase 4 cho Lighting, Mood / Grade, khoa DNA, grade preview, mood variations va mock `grade_apply`.

## Da xong

- Bat `lighting` va `mood_grade` trong `apps/desktop/src/features/workspace/modules.ts`; noi cac panel vao `PropertyPanel` va Grade Canvas vao center workspace.
- Them `features/lighting/LightingPanel.tsx`: time-of-day, mat troi, intensity/shadows/ambient, preset pack, danh sach den nhan tao (them/xoa/bat/tat/zone/nhiet mau 2200-6500 K/intensity), weather fields/presets va lock cho lighting/weather.
- Them `features/mood/MoodGradePanel.tsx`: mood/weather preset + fields, lock, toan bo grade sliders/look/reset, autosave, `Apply grade`, `Save as project grade`, provider/model batch dialog, cost hint va lua chon 2-8 mood presets.
- Them `features/mood/GradeCanvas.tsx`: downscale long edge toi da 1600 px, before/after/split, grade math va xu ly theo chunk qua `requestAnimationFrame` de keo slider khong chan UI.
- Mo rong `DnaFields`/`LockToggle` cho lighting, weather, mood, color grade; mo rong autosave store voi `applyGrade` va chon asset moi.
- Them `features/mood/variation.ts`: `buildMoodVariationItems` va `adoptMoodPreset`, ton trong lock, giu source lam reference dau tien va them preservation instruction.
- Mo rong Contact Sheet de nhom batch variation theo preset/job label (`groupMoodContactSheet`).
- Mo rong bridge request/response voi `grade_apply`; mock backend tao asset regular moi + version `color_grade`, giu source nguyen ven.
- Them `lib/grade.ts` stand-in theo pipeline API section 12.3 va `GRADE_LOOKS`. Day la stand-in tam thoi vi P4-A se cung cap implementation domain dung chung.
- Bo sung toan bo chuoi moi vao ca `en.ts` va `vi.ts`, CSS cho light list/grade preview.
- Cap nhat expectation module trong `tests/units.test.ts`, them `tests/p4-ui.test.ts` cho grade identity/warmth, variation building/adoption, lock behavior, mock grade asset/version va i18n parity.

## Quyet dinh / stand-in can thay khi merge

- `apps/desktop/src/lib/grade.ts` phai duoc thay bang import tu `@arch/domain/grade` (P4-A), giu cung API `applyGradePixel`, `applyGradeToImageData`, `GRADE_LOOKS`; xoa stand-in sau khi domain export on dinh.
- `features/mood/variation.ts` la fallback UI builder de branch nay typecheck doc lap. Khi P4-A export builder chinh thuc, uu tien dung `buildMoodVariationItems`/`adoptMoodPreset` cua domain va giu UI adapter mong.
- Pack presets duoc doc dong qua `knowledge.resolve(...).pack`; khi schema pack 1.2.0 da merge, cac preset lighting/weather/mood se tu hien thi. Fallback mood toi thieu chi phuc vu mock/pack cu.
- Mock `grade_apply` dung SVG placeholder (browser mock khong co file raster that) nhung van tao asset/version/lineage dung contract va khong mutate source; backend Rust chiu trach nhiem pixel PNG day du.
- Browser preview da khoi dong duoc Vite o `http://127.0.0.1:1420/`. CUA browser tool trong sandbox bi reset boi trusted Node process nen khong chup/kiem tra UI tuong tac duoc; khong co network/provider call nao.

## Con no

- Cho P4-A/P4-B merge de bo stand-in grade/variation va dung schema/preset/light-id chinh thuc; kiem tra lai prompt compiler pc-1.2.0 va bridge Rust response tren cay da merge.
- Can chay parity test TS/Rust grade vectors sau khi P4-A/B dua test vectors va backend `grade_apply` vao.

## Lenh test va ket qua

- `npm.cmd run verify` - PASS: typecheck, ESLint, 23 Vitest files / 300 tests, Rust 219 passed + 5 ignored.
- `cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml` - PASS.
- `npx.cmd prettier --check .` - PASS.
- `npm run verify` khong goi duoc truc tiep trong PowerShell do execution policy chan `npm.ps1`; dung `npm.cmd` tuong duong va chay xanh.

## Cam bay

- Khong chay `npm install/ci`, khong doc `.env`, khong goi provider/network.
- `docs/agent-notes/p4-ui.md` ban dau la file untracked template; da cap nhat noi dung ban giao, khong commit theo yeu cau sandbox.
