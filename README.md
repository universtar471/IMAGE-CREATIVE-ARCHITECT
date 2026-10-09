# Arch AI Studio (IMAGE-CREATIVE-ARCHITECT)

Desktop application for producing consistent architectural image sets from structured
architectural data ("DNA"), references and — in later phases — replaceable AI providers.

Current state: **Phase 2** — provider-neutral AI foundation on top of the Phase 1 local core:
Generate module (Hero / Variation), provider settings, generation History and version lineage.
Providers: Google Gemini and OpenAI GPT Image (each needs an API key) and an offline
`local_preview` placeholder renderer.
See `CLAUDE.md`, `docs/`, `tasks/PHASE_01.md` and `tasks/PHASE_02.md` for the product plan.

## Layout

```text
apps/desktop/            Tauri 2 + React 19 + TypeScript + Vite desktop app
  src/                   UI (app shell, features, components, typed bridge)
  src-tauri/             Rust backend: SQLite migrations, repositories, services, commands
packages/domain/         Pure TS domain: Zod schemas, knowledge-pack resolution, prompt compiler
  schema/                JSON Schema exported from Zod (validated by the Rust backend)
knowledge/<type>/<sub>/  Knowledge Packs (JSON data, bundled into the app)
docs/                    Architecture, data model, contracts, UI spec, ADRs, progress
```

## Requirements

- Node.js 22+ (tested with 24) and npm
- Rust stable (tested with 1.98) + MSVC build tools (Windows)
- WebView2 (preinstalled on Windows 11)

## Commands

```bash
npm install
npm run dev            # launch the desktop app (Tauri dev, hot reload)
npm run build          # production build + installer
npm run typecheck      # TypeScript (all workspaces)
npm run lint           # ESLint
npm test               # Vitest (domain + desktop UI logic)
npm run test:rust      # cargo test (migrations, repositories, services)
npm run check:rust     # cargo check
npm run verify         # typecheck + lint + test + test:rust
npm run schema:export  # regenerate packages/domain/schema/project-dna.schema.json
npm run format         # Prettier
```

`npm run dev -w @arch/desktop` (plain Vite on http://localhost:1420) runs the UI in a browser
against an in-memory mock backend — handy for UI work, but the Rust backend is the source
of truth.

## Data location

Projects live in the OS app-data folder (`%APPDATA%\com.archaistudio.desktop` on Windows):

```text
studio.db                         SQLite (WAL)
projects/<PRJ_id>/assets/original managed copies of imported images (never modified)
projects/<PRJ_id>/assets/derived  future derived images (with lineage)
projects/<PRJ_id>/previews        thumbnails
projects/<PRJ_id>/exports         future exports
```

Set `ARCH_STUDIO_DATA_DIR` to use a different folder (e.g. a throwaway test profile).

## AI providers and API keys

Open **Generate → Provider settings** (or the provider chip in the top bar), paste the key and
press Save. Keys are stored in the OS credential store (Windows Credential Manager, entry
`com.archaistudio.desktop.provider` / `<provider id>`), never in SQLite, project files or the
webview. For development you can instead set `ARCH_STUDIO_GEMINI_API_KEY`,
`ARCH_STUDIO_OPENAI_API_KEY` or `HHTECH_API_KEY` (see `.env` below).

| Provider | Get a key | Account needs |
|---|---|---|
| `gemini` | aistudio.google.com/apikey | billing on the key's project (image models have little or no free quota) |
| `hhtech` | hhtechapi.com | `HHTECH_BASE_URL` in the environment or `.env` (see below) |
| `openai` | platform.openai.com/api-keys | prepaid credits (platform.openai.com/settings/organization/billing); GPT Image models may require Organization Verification (platform.openai.com/settings/organization/general) |

OpenAI models: GPT Image 2.5 Sunburst, GPT Image 2.5 Flare and GPT Image 2. Requests without
references use `/v1/images/generations`; with references (up to 16) `/v1/images/edits`. Each
request asks for quality `high` and PNG output; the aspect ratio maps to one concrete size (the API has
no resolution tiers, so no image size is offered; no ratio lets the API choose).
A 429 for missing credit or a spend limit fails at once with a billing hint instead of being
retried.

### HHTECH (OpenAI-compatible gateway)

`hhtech` reuses the OpenAI adapter against a third-party gateway that serves image and chat
models under one base URL. It is configured only from the environment (never SQLite or the UI):

| Variable | Default | Meaning |
|---|---|---|
| `HHTECH_API_KEY` | — | Bearer key. A key saved in provider settings wins; `ARCH_STUDIO_HHTECH_API_KEY` is also read. |
| `HHTECH_BASE_URL` | — (required) | e.g. `https://hhtechapi.com/v1`; https only (http only for localhost). Without it the provider shows "not configured". |
| `HHTECH_IMAGE_MODEL` | — (full catalog below) | comma-separated base ids that restrict and order the model picker; an id outside the catalog is still offered as a plain entry (no tiers, no price) |
| `HHTECH_IMAGE_SIZE` | `1024x1024` | size sent when no tier is chosen, without an aspect ratio (and for its own ratio); `auto` omits it |
| `HHTECH_IMAGE_QUALITY` | `medium` | `quality` sent to GPT models when the Quality control is on **Default** (never sent to Gemini) |
| `HHTECH_CHAT_MODEL` | `claude-sonnet-5` | chat model used by **Enhance prompt** |
| `HHTECH_TIMEOUT_SECS` | `600` | seconds one images call may take (30–3600); several outputs are sent as parallel single-image calls; a timed-out call is not retried automatically (press Retry) |

Built-in model catalog (in code, `providers/hhtech/catalog.rs`), offered in this order when
`HHTECH_IMAGE_MODEL` is unset. Prices are the gateway's published price per image (VND,
2026-10-09) and only an estimate; the model picker shows them in the label:

| Model (base id) | Family | 1K | 2K | 4K | Quality choice | References |
|---|---|---|---|---|---|---|
| GPT Image 2.5 Sunburst (`gpt-image-2.5-sunburst`) | GPT | 280đ | 600đ | 900đ | low / medium / high | 16 |
| Gemini 3 Pro Image "Banana" (`gemini-3-pro-image`) | Gemini | — | 500đ | 800đ | — | 14 |
| GPT Image 2.5 Flare (`gpt-image-2.5-flare`) | GPT | 280đ | 600đ | 900đ | low / medium / high | 16 |
| GPT Image 2 (`gpt-image-2`) | GPT | 180đ | 500đ | 800đ | low / medium / high | 16 |
| Gemini 3.1 Flash Image (`gemini-3.1-flash-image`) | Gemini | — | 500đ | 800đ | — | 14 |
| Gemini 2.5 Flash Image (`gemini-2.5-flash-image`) | Gemini | — | 500đ | 800đ | — | 14 |

Unlike the official OpenAI provider, the **Image size** tiers here (1K / 2K / 4K for GPT, 2K / 4K
for Gemini, as the gateway publishes them) are real,
separately billed products of the gateway. The pixel size follows the aspect ratio and the
tier: long edge 1024 / 2048 / 3840, short edge by the ratio, rounded to a multiple of 16
(e.g. 16:9 at 2K = 2048x1152).

- **GPT models** get the tier through `size`: the base id plus the computed size (live:
  `gpt-image-2` + 2048x2048 returned a 2048x2048 PNG; `gpt-image-2` + 1024x576, quality low,
  returned 1024x576, so non-square 1K sizes work). `quality` is your **Quality** choice,
  or `HHTECH_IMAGE_QUALITY` on Default.
- **Gemini models** ignore `size` for resolution, so the tier is a model-id suffix:
  `<base>-2k` or `<base>-4k` on both endpoints (2K by default; the bare base id, 1024 px, is
  never sent); `size` still sets the aspect (live:
  `gemini-3-pro-image-2k` + 2048x1152 returned 2752x1536). The `-edit-*` ids returned HTTP 502
  and are never used. No `quality` is sent and no Quality control is shown.
- The Generate button shows the estimated cost (`≈ images × tier price`); the camera batch
  dialogs add the total to their summary. The tier and the id actually sent are recorded in
  the generation's provider metadata (`tier`, `requestModel`).

Requests: `POST {BASE}/images/generations` (JSON, `response_format: b64_json`) without
references, `POST {BASE}/images/edits` (multipart; one reference as `image`, several as
`image[]`, the latter unverified on this gateway) with references. A `data[].url` answer is
downloaded (https only, max 50 MB). Generations take ~45–75 s (Gemini 2K) to ~3 min (GPT 2K) on
the gateway; the timeout is `HHTECH_TIMEOUT_SECS`. **Test** in provider settings lists
`GET {BASE}/models` and says whether the configured models are there. Existing `.env` files
with `HHTECH_IMAGE_MODEL=gpt-image-2` keep working (that one model, now with tiers); remove the
line to get the whole catalog.

**Enhance prompt** (Generate panel, next to the extra prompt) sends your extra text plus the
compiled DNA prompt to `POST {BASE}/chat/completions` and shows the rewrite to Accept or
Discard. It is disabled until HHTECH is configured.

### `.env`

Copy `.env.example` to `.env` (gitignored) and fill it in. At startup the app loads, without
ever overriding a variable that is already set and without logging values:
`ARCH_STUDIO_ENV_FILE` (an explicit file) if set, then `.env` in the working directory, and in
dev builds also `.env` in each parent directory and in the repository root. Restart the app
after editing `.env`. From a git worktree, point `ARCH_STUDIO_ENV_FILE` at the main checkout's
`.env`.

`local_preview` needs no key and no network: it produces deterministic placeholder images so the
whole flow (history, lineage, "Use as master") can be tried for free.

Live smoke tests (each costs one image, never prints the key):

```bash
cd apps/desktop/src-tauri
ARCH_STUDIO_GEMINI_API_KEY=<key> cargo test gemini_live -- --ignored --nocapture
ARCH_STUDIO_OPENAI_API_KEY=<key> cargo test openai_live -- --ignored --nocapture
# optional: ARCH_STUDIO_OPENAI_MODEL=gpt-image-2.5-flare (default gpt-image-2.5-sunburst)
```

HHTECH live tests read `.env` (and the key from provider settings or `HHTECH_API_KEY`), print
the gateway's error clearly on failure and save output PNGs to a temp folder (path printed).
`hhtech_live_chat` is one chat call; `hhtech_live_generate` one 1024x1024 image (~100 s);
`hhtech_live_edit` one edit with a small generated PNG as reference:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml hhtech_live -- --ignored --nocapture
# one at a time: ... hhtech_live_chat -- --ignored --nocapture
```

Contract fixtures: `cargo test` checks the JSON in `apps/desktop/tests/fixtures/backend` that the
UI's Zod schemas parse. After changing a DTO, run
`UPDATE_BACKEND_FIXTURES=1 cargo test contract_fixtures` in `apps/desktop/src-tauri` and commit.
