# wt/p5-backend

- Agent: codex
- Tach tu: main
- Tao luc: 2026-10-10 03:17

## Muc tieu

Phase 5 backend theo API_CONTRACTS §14: local_upscale, purpose enhance, exact output resize,
validation/gating, generative references, batch compatibility và contract fixtures.

## Da xong

- Thêm provider `local_upscale`/model `lanczos3`, Lanczos3 + unsharp mask radius 1, amount `detailStrength / 100 * 0.6`, threshold 2/255; giữ alpha và PNG output.
- Mở rộng `GenerationPurpose::Enhance`, `params.enhance`, validation exact one ready reference, no-downsize, cap 8192, conservative provider/model và workflow approved-master gate.
- Generative enhance gửi đúng một reference; HHTECH Gemini 3 Pro Image tự chọn tier 2K/4K theo target.
- Resize output enhance ngoài DB transaction; version/asset operation `enhance`, lineage và `sourceLongEdge`/`providerLongEdge`/`finalLongEdge` trong operation JSON.
- Thêm test provider, conservative/generative end-to-end, validation và ignored `hhtech_live_enhance`; regenerate backend fixtures với enhance submit/get.

## Con no

- Chờ tích hợp schema/domain Phase 5 từ nhánh `wt/p5-domain`; frontend contract sẽ nhận `purpose: "enhance"` và `params.enhance` từ nhánh đó.

## Lenh test

- `cargo test -q --no-default-features` — 243 passed, 6 ignored.
- `cargo test -q contract_fixtures --no-default-features` — passed (fixtures regenerated with `UPDATE_BACKEND_FIXTURES=1`).
- `cargo fmt --all -- --check` — passed.
- `cargo clippy --all-targets -- -D warnings` — passed.
- Release conservative test: `cargo test -q --release conservative_enhance_is_local_exact_and_keeps_source_bytes_and_lineage --no-default-features` — passed, wall time 110.31s (first release build; includes compilation).
- `npm.cmd run verify` — typecheck/lint passed; Vitest has the expected 3 failures for new enhance fixtures because the parallel domain schema still lists only the four pre-Phase-5 purposes. Rust stage was not reached by the npm chain.

## Cam bay da gap

- Worktree không commit theo yêu cầu. Không có live paid API call; HHTECH smoke test chỉ `#[ignore]`.
- `image` unsharp helper không có amount trực tiếp nên backend áp dụng Gaussian sigma 1 và blend amount theo contract, alpha copy nguyên trạng.

