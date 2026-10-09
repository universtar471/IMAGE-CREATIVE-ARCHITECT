# wt/hhtech-models

- Agent: claude
- Branched from: main
- Brief: `docs/agent-tasks/hhtech-models.md`

## Goal

Better HHTECH image quality: a built-in model catalog (GPT Image 2 / 2.5 Flare / 2.5 Sunburst,
Gemini 3 Pro / 3.1 Flash / 2.5 Flash Image), real billed 1K/2K/4K tiers, a quality choice in the
app and a cost estimate in VND.

## Done

- `providers/hhtech/catalog.rs`: the six models in the brief's default order, labels with the
  price list, family-specific routing. `HHTECH_IMAGE_MODEL` unset = full catalog; set = restricts
  and orders it; unknown ids stay plain GPT-style entries (no tiers, `priceHint: null`, quality
  choice offered, as before). An empty `HHTECH_IMAGE_MODEL=` (as in `.env.example`) = unset.
- OpenAI adapter (`providers/openai`): `TierStrategy` (None / Size / IdSuffix) + `Route` per model
  in `Config.routes`; `tier_size(ratio, tier)` (long edge 1024/2048/3840, short edge rounded to
  a multiple of 16) and `tier_model_id`. GPT: base id + computed `size`. Gemini: `<base>` (1K),
  `<base>-2k`, `<base>-4k` on both endpoints, computed `size` for the aspect, no `quality`.
  No tier → previous behaviour (`HHTECH_IMAGE_SIZE` fallback). Tier without ratio → ratio of
  `HHTECH_IMAGE_SIZE`, else 1:1. `meta` gains `requestModel` and `tier`; `meta.quality` falls back
  to the quality sent.
- Contract: `ModelCapabilities.qualityOptions` + `priceHint`; `GenerationParams.quality`
  (`#[serde(default)]` / Zod `.default(null)`, so old rows parse). `generation_submit` and the
  adapter reject a quality not offered. Official OpenAI unchanged (fixed `high`, no options).
- UI: `QualityField` (Default/Low/Medium/High) in the Generate panel and both batch dialogs,
  shown only when the model has options; cost next to Generate (`≈ 1.200đ`, or "No published
  price for 1K"); batch summary appends the total. Domain helpers `estimateCostVnd`,
  `formatVnd`, `costHintText`.
- Mock backend mirrors the catalog (the `backendContract` test compares it to the Rust fixture).
- Fixtures regenerated; README, API_CONTRACTS §9/§11, `.env.example`, provider help updated.

## Decisions / open debts

- Gemini 1K is offered (= base id, per the brief) but has no published price, so `priceHint`
  has no "1K" key and the label lists only 2K/4K. If the gateway bills 1K at the 2K price, add it.
- Gemini `maxReferenceImages` = 14 is UNVERIFIED (only 1 reference tested live). Several
  references go as `image[]`, also unverified on this gateway.
- Ids `gemini-3.1-flash-image`, `gemini-2.5-flash-image`, their `-2k/-4k` variants, and
  `gpt-image-2.5-flare` were not called live; only `gpt-image-2`, `gpt-image-2.5-sunburst`,
  `gemini-3-pro-image(-2k)` were.
- 1K non-square GPT sizes (e.g. 1024x576) are below official OpenAI's 655,360-pixel minimum; the
  gateway's behaviour for them is unverified (it upscaled 1024x1024 to 1254x1254 for Sunburst).
- 4K uses a 3840 long edge (as the brief says); 3840x3840 at 1:1 is untested live.
- No live calls were made in this branch.

## Test commands

```bash
npm ci
npm run verify
cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings
npx prettier --check .
# after DTO changes: UPDATE_BACKEND_FIXTURES=1 cargo test contract_fixtures (in src-tauri)
```

## Pitfalls hit

- Python on Windows writes CRLF in text mode; use `newline=''` (repo is `eol=lf`).
- Perl `s|...|...|` with `\|` in the pattern turns into alternation and inserts at offset 0.
- The mock's HHTECH models must equal the `provider_list` fixture exactly (backendContract test).
