# P4-B Backend handoff

## Muc tieu

Trien khai pipeline color grade Rust theo API_CONTRACTS section 12.3, command `grade_apply` theo section 12.4, DNA additive passthrough va backend contract fixture.

## Da xong

- Them `apps/desktop/src-tauri/src/services/grade.rs`:
  - `f32` sRGB/linear math dung thu tu exposure, temperature/tint, contrast, highlights, shadows, whites, blacks, clarity, dehaze, vibrance, saturation.
  - Giu nguyen alpha tung pixel; output luon PNG RGBA va thumbnail JPEG.
  - Kiem tra `schemaVersion`/range theo ColorGradeDNA, project ownership va asset `ready`.
  - Doc/decode/grade ngoai DB lock; transaction chi insert asset + version sau khi file hoan tat.
  - `parent_asset_id` tro source, `parent_version_id` la latest source version, source row/file khong bi sua; loi transaction don original/thumbnail.
  - Test parity uu tien `packages/domain/test-vectors/grade.json`, fallback `src-tauri/tests/grade.json`; test alpha, range, lineage va 4096x4096.
- Dang ky module/command `grade_apply` trong `services/mod.rs`, `commands.rs`, `lib.rs`.
- Them DNA additive compatibility trong `dna_validation.rs` cho `presetId`, lighting `id`/`enabled`, `locks.mood`; them round-trip test. Cac field duoc kiem tra kieu/ID va van persist nguyen ven khi schema embedded cu chua biet field.
- Them `grade_apply` vao `contract_fixtures.rs` va regenerate `apps/desktop/tests/fixtures/backend/*.json`, gom fixture moi `grade_apply.json`.

## Quyet dinh / luu y

- Branch nay chua co cac file ADR-004/008/015/020 duoc brief liet ke; cac invariant duoc doi chieu voi code hien co va API_CONTRACTS section 12.
- Khong them crate song song; vong lap single-threaded du muc tieu benchmark.
- Benchmark release tren may nay: `cargo test --release grades_a_4096_square_without_allocating_per_pixel_state -- --nocapture` in `grade 4096x4096: 1.1035776s`.
- P4-A phai tao `packages/domain/test-vectors/grade.json`; sau merge can chay lai parity test de xac nhan vectors domain pass. Neu schema P4-A da validate truc tiep cac field additive, giu round-trip test va kiem tra khong co khac biet schema.

## Con no / phu thuoc

- `npm run verify` tren branch nay dung o Vitest vi P4-C chua them response schema mapping cho command moi: `no schema for grade_apply`. Typecheck, ESLint va 295 test khac da pass; sau khi P4-C dang ky schema, chay lai toan bo verify.
- PowerShell execution policy chan `npm`/`npx` shim `.ps1`; da chay tuong duong bang `npm.cmd`/`npx.cmd`.

## Lenh test va ket qua

- `cargo fmt --check` - PASS.
- `cargo clippy --all-targets -- -D warnings` - PASS.
- `cargo test` - PASS: 225 passed, 5 ignored.
- `$env:UPDATE_BACKEND_FIXTURES='1'; cargo test contract_fixtures` - PASS, fixtures regenerated.
- `npx.cmd prettier --check .` - PASS.
- `npm.cmd run verify` - BLOCKED only by missing P4-C `grade_apply` schema mapping as noted above.

## Cam bay

- Khong commit trong sandbox theo brief; cac thay doi dang nam trong working tree de lead commit.
- Fixture regeneration lam doi normalized IDs/order cua nhieu fixture cu vi `grade_apply` tao asset/version truoc generation; day la thay doi co chu dich va duoc kiem tra boi `contract_fixtures`.
