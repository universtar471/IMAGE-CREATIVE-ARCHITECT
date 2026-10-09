# HHTECH model catalog, resolution tiers and quality choice

Branch `wt/hhtech-models` (from main). The user wants better image quality from the HHTECH
gateway: choose stronger models, real 1K/2K/4K tiers, and quality in the app.

Read first:
- `apps/desktop/src-tauri/src/providers/hhtech/` and `providers/openai/` (the gateway runs on the OpenAI adapter in `Flavor::Gateway`)
- `docs/agent-notes/hhtech-provider.md`, `hhtech-timeout.md`, `gateway-empty-answer.md`
- `docs/API_CONTRACTS.md` §9 and §11
- the Generate panel in `apps/desktop/src/`
- `mockBackend.ts`

## Verified live facts (lead's calls, 2026-10-09; do not make live calls yourself)

Base URL is `https://hhtechapi.com/v1`. The gateway bills per resolution tier. Its web UI shows these prices per image:

| Model | 1K | 2K | 4K |
|---|---|---|---|
| GPT Image 2 | 180đ | 500đ | 800đ |
| GPT Image 2.5 Flare | 280đ | 600đ | 900đ |
| GPT Image 2.5 Sunburst | 280đ | 600đ | 900đ |
| Gemini 3 Pro Image ("Banana") | — | 500đ | 800đ |
| Gemini 3.1 Flash Image | — | 500đ | 800đ |
| Gemini 2.5 Flash Image | — | 500đ | 800đ |

Grok exists but is out of scope.

**GPT Image models: tier comes from the `size` field.**
- Send the base id (`gpt-image-2`, `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`) plus `size`:
  - `gpt-image-2` with `size` 2048x2048 → 2048x2048 PNG in 177 s.
  - `gpt-image-2.5-sunburst` with 1024x1024 → 1254x1254 in 150 s.
- A `-2k` suffixed id with size 1024x1024 returned 1254x1254, so the suffix seems ignored for GPT. Do not use suffixes for GPT.
- Edits use the same base id (verified earlier with `gpt-image-2`).

**Gemini models: tier comes from a model-id suffix.**
- The base id ignores `size`:
  - `gemini-3-pro-image` with size 2048x2048 → 1024x1024 in 35 s.
  - `edits` with the base id + 1 reference → 1024x1024 in 30 s, with excellent geometry preservation.
- With the suffix, `size` still sets the aspect:
  - `gemini-3-pro-image-2k` + size 2048x1152 → 2752x1536 in 47 s.
  - `edits` with `gemini-3-pro-image-2k` → 2048x2048 in 75 s.
- **`gemini-3-pro-image-edit-2k` on `/images/edits` returned HTTP 502.** So the `-edit-*` ids must NOT be used; use `<base>-2k` / `<base>-4k` on both endpoints.
- The base id = 1K tier (1024).
- `quality` was not sent to Gemini; do not send it for Gemini models.

## Scope

1. **Model catalog for HHTECH.**
   - A built-in catalog (code, not env) for the six models above. Each entry has:
     - label, family (gpt/gemini)
     - tiers available and per-tier price hint in VND
     - tier strategy: `size` for gpt, id suffix for gemini
     - whether `quality` is sent (gpt yes, gemini no)
     - maxReferenceImages: gpt 16. For gemini use 14 and mark it unverified in the note; we only tested 1.
   - Default model order: GPT Image 2.5 Sunburst, Gemini 3 Pro Image, GPT Image 2.5 Flare, GPT Image 2, Gemini 3.1 Flash Image, Gemini 2.5 Flash Image.
   - Labels show the price hint, e.g. "GPT Image 2.5 Sunburst · 1K 280đ / 2K 600đ / 4K 900đ".
   - `HHTECH_IMAGE_MODEL`, if set, still restricts/orders the list:
     - It accepts catalog base ids.
     - Unknown ids stay allowed as plain gpt-style entries with no tiers, as today.
     - Document that when unset the full catalog is offered.
   - Existing users' `.env` sets `HHTECH_IMAGE_MODEL=gpt-image-2`; it keeps working.

2. **Tiers.**
   - HHTECH models advertise `imageSizes` `["1K","2K","4K"]`, or `["1K","2K","4K"]` minus what the model lacks. These ARE real billed tiers here, unlike the official OpenAI provider, which keeps none. Say so in a code comment, citing these facts.
   - Gemini 1K = base id.
   - Pixel size from aspect ratio + tier: the long side is 1024 / 2048 / 3840 (4K), the short side by ratio, rounded to a multiple of 16.
   - `HHTECH_IMAGE_SIZE` becomes the fallback when neither ratio nor tier is chosen.
   - Request mapping:
     - gpt: base id + computed `size`.
     - gemini: `<base>` for 1K, `<base>-2k`, `<base>-4k`, plus computed `size` for the aspect.
   - Record the tier and actual model id sent in `meta`.

3. **Quality choice in the app.**
   - Add an optional `quality` to the generation params contract: `"low" | "medium" | "high" | null`, null = provider default.
   - Add a model capability listing the quality options it supports (empty = none, null required).
   - Zod schemas in `packages/domain` + Rust DTOs + validation:
     - HHTECH gpt models: `["low","medium","high"]`.
     - Gemini, official OpenAI and local_preview: empty.
     - Official OpenAI keeps its fixed `high`. Do not change its behaviour.
   - `HHTECH_IMAGE_QUALITY` = the default when null.
   - The Generate panel shows a Quality segmented control only when the model has options. Tier control already exists via imageSizes; check it renders.
   - Mock backend mirrors all of this. Update fixtures (`UPDATE_BACKEND_FIXTURES=1 cargo test contract_fixtures`) and `API_CONTRACTS.md`.

4. **Cost hint in the UI.**
   - Next to the Generate button for HHTECH, show the estimated cost: images × tier price, e.g. "≈ 1.200đ".
   - The price comes from the catalog, exposed through a capability field like `priceHint: {"1K": 280, ...}` (VND) or null for other providers.
   - Batch dialogs (anchors / Render cameras) show the total too, if cheap to add.

5. **Tests.**
   - Rust: catalog, env restriction, size computation per ratio×tier, gemini id suffixing on both endpoints, quality sent or omitted, meta.
   - TS: schema, Generate panel controls and cost text, mock.
   - Keep all existing tests green.

## Done when

- `npm run verify` green; `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `npx prettier --check .` clean.
- README provider section updated (the model table with prices + the tier/quality explanation).
- `docs/agent-notes/hhtech-models.md` written.
- Small commits, each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
