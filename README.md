# Arch AI Studio (IMAGE-CREATIVE-ARCHITECT)

Desktop application for producing consistent architectural image sets from structured
architectural data ("DNA"), references and — in later phases — replaceable AI providers.

Current state: **Phase 2** — provider-neutral AI foundation on top of the Phase 1 local core:
Generate module (Hero / Variation), provider settings, generation History and version lineage.
Providers: Google Gemini (needs an API key) and an offline `local_preview` placeholder renderer.
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
`com.archaistudio.desktop.provider` / `gemini`), never in SQLite, project files or the webview.
For development you can instead set `ARCH_STUDIO_GEMINI_API_KEY`.

`local_preview` needs no key and no network: it produces deterministic placeholder images so the
whole flow (history, lineage, "Use as master") can be tried for free.

Live Gemini smoke test (costs one image, never prints the key):

```bash
cd apps/desktop/src-tauri
ARCH_STUDIO_GEMINI_API_KEY=<key> cargo test gemini_live -- --ignored --nocapture
```

Contract fixtures: `cargo test` checks the JSON in `apps/desktop/tests/fixtures/backend` that the
UI's Zod schemas parse. After changing a DTO, run
`UPDATE_BACKEND_FIXTURES=1 cargo test contract_fixtures` in `apps/desktop/src-tauri` and commit.
