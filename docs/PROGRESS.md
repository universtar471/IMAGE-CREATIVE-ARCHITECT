# Progress

## Imported-image review and Blueprint branding (ADR-045)
- Imports appear in Node before any generation; initial fit waits for layout, tray selection follows the node.
- Portrait tray cards fit their allocated height. Field instructions move to accessible help buttons.
- Imported images support enhancement, region edit, grading and variation without Master promotion;
  Rust/mock/UI agree, while production and safety guards remain.
- Branding follows the owner's Blueprint logo board across header, title, favicon and native icons.
- Validation: 1141 Vitest tests, 367 Rust tests (6 live tests ignored), lint/typecheck/format/build,
  clippy and browser resize/import/edit/fullscreen checks. See `docs/design/imported-image-review/QA.md`.

## V6.1-R2 — node panel routing, fullscreen and verification
- Node selection now routes the editing module as well as the toolbar; video drafts survive panel changes.
- The viewer supports real fullscreen, pauses background playback and restores video sources after StrictMode cleanup.
- Be Vietnam Pro is bundled offline under SIL OFL 1.1; `.github/workflows/verify.yml` adds frontend/browser/backend checks.
- Windows validation: 1136 Vitest tests, 366 Rust tests (6 live tests ignored), typecheck, lint, format, build, rustfmt and clippy.
- Chromium acceptance checks verify node panels, resize, fullscreen, real WebM playback, inspector scroll and zero writes.
- Evidence and remaining native WebView2/display-scale limitations: `docs/design/v6-1/QA_R2.md`.
- The R1 notes below are historical; R2 resolves their unbundled-font and unmeasured-scroll gaps.

## V6.1-R1 — Studio shell, contextual selection, large viewer (ADR-044), branch `claude/ux-v6-1`
- **Done:**
  - **PR #2:** merged into the V6 branch (not into `main`).
  - **Shell:** responsive tiers measured from the shell itself: icon-only nav, an inspector drawer below 1000 px, and short-window rules. The Tauri minimum is 800×600.
  - **Selection:** one normalised selection and an action registry.
  - **Toolbar and inspector:** a floating contextual toolbar and a selection inspector.
  - **Modes:** a Studio | Node switch that keeps the Node Canvas pan/zoom.
  - **Navigation:** four groups with a collapsible Advanced DNA.
  - **Previews:** a Studio preview router and the large image/video viewer.
  - **Video:** the poster origin is recorded and labelled honestly.
  - **Help and type:** help popovers, preset cards sized to the panel, and a type scale.
- **Checks in the cloud container:** typecheck, lint, Prettier, Vitest, Vite build, rustfmt, clippy, `cargo test` and the contract fixtures pass. The Playwright QA matrix ran on the browser mock (`docs/design/v6-1/QA_REPORT.md`).
- **Not yet verified:**
  - The native Tauri window on Windows: real maximize/restore, real display scaling and video through the asset protocol.
  - Be Vietnam Pro (not bundled).
  - The uncommitted Typography V2 files on the owner's machine (not available).

## B1 — Image to video (ADR-043)
- **Done:**
  - **Providers:** four video providers with key slots: Kling (JWT), Veo (Gemini API), Seedance (ModelArk) and Comfy Cloud (user workflow).
  - **Queue path:** submit → stored task → poll → download → video asset with lineage. Retry and restart resume the task instead of resubmitting (migration 12 `video_tasks`).
  - **Domain:** 8 motion presets and `compileVideoPrompt` `vc-1.0.0`.
  - **UI:** "Video" module (panel, player, first-frame comparison) and ▶ badges in the tray and on the branch canvas.
- **Checks in the cloud container:** typecheck, lint, Prettier, Vitest, rustfmt, clippy, `cargo test` and the contract fixtures pass. Playwright screenshots were taken on the mock backend.
- **Not yet verified:**
  - **Live vendor calls:** none was made. The adapters are tested only against mock HTTP servers built from public API descriptions. Enter a key and make one 5-second clip per provider.
  - **Native window:** video playback through the asset protocol has not been tried.
  - **Comfy Cloud:** not run with a real exported workflow.

## M4 — Recipes and evidence analysis (ADR-042)
- **Done:**
  - **Recipes:** 4 recipes (lighting × 6, weather × 4, facade colours × 4, moodboard). They run behind one spend confirm, with one generation per variant.
  - **Presets:** a facade palette group and a material moodboard preset (`ps-1.1.0`).
  - **Evidence board:** the vision call goes through the `dna_assist` `analysis` scope; the SVG board is drawn by the app, every item labelled inferred, and can be saved as a derived image.
- **Checks in the cloud container:** typecheck, lint, Prettier, Vitest, rustfmt, clippy and `cargo test` pass.
- **Not yet verified:** a live HHTECH vision call, the image quality of the palette and moodboard prompts, and the native window.

## M3 — Branch canvas (ADR-041)
- **Done:**
  - Branch graph derived from generation lineage (domain, deterministic) and a depth-column layout with saved positions (migration 11).
  - "Branches" tab with "Use as source", "Reuse presets", "Copy prompt", "Retry", and A/B compare.
  - Quick generate also accepts AI outputs, with a warning after 3 AI images in a row.
- **Checks in the cloud container:** typecheck, lint, Prettier, Vitest, rustfmt, clippy, `cargo test` and the contract fixtures pass.
- **Not yet verified:** the native Windows window, and large projects (hundreds of generations) for canvas performance.

## M2 — My presets, SketchUp inbox, custom gateway (ADR-040)
- **Done:**
  - **My presets:** SQLite migration 10, commands, and a UI row with save, apply and delete (with confirmation).
  - **SketchUp inbox:** service and commands with path checks, deduplication and `imported/`; "Receive from SketchUp" in Generate.
  - **SketchUp extension:** Ruby extension and `.rbz` packer.
  - **Gateway:** generic `gateway` provider on a shared environment parser.
- **Checks in the cloud container:** typecheck, lint, Prettier, Vitest, rustfmt, clippy and `cargo test` pass; contract fixtures regenerated; `ruby -c` passes for the extension.
- **Not yet verified:** the extension inside SketchUp on Windows, the inbox thumbnails in the native window, and a real gateway such as BEAR.

## M1 — Preset-first Studio (ADR-039), branch `claude/vizmaker-m1-presets`
- **A1 domain:** 47 shot presets, `setShotPresets`/`togglePreset`, ShotIntent `presetIds` / `lighting` / `gradeLookId`, compiler `pc-1.10.0` (PRESETS section, per-shot time and weather), validator `cv-1.3.0` (`LOCKED_WEATHER_CONFLICT`).
- **A2–A6 desktop:** preset grid and chips, Simple / Advanced Generate panel, quick generate from a source image (domain, Rust and mock), regrouped left navigation.
- **Checks:** typecheck, lint, Prettier, Vitest and `cargo test` pass in the cloud container (Linux, with the GTK/WebKit dev packages installed).
- **Not yet verified:** the native Windows window, and a live HHTECH generation with presets.
- **Next:** M2 (My presets, SketchUp inbox, configurable OpenAI-compatible gateway). Preset wording is tuned from `docs/presets/PRESET_OBSERVATIONS.md`.

## Current phase
Phase 3 — Anchor + Camera production, merged to `main` (2026-10-09) on the user's provisional
approval. Codex reviews of the three Phase 3 branches are pending (Codex quota). Phase 2 review
findings (see `docs/agent-reviews/`) were fixed inside the Phase 3 branches.

## Phase 3 — completed
Built in three parallel worktrees on the contract branch `wt/p3-base` (`tasks/PHASE_03.md`,
ADR-016…018, `docs/API_CONTRACTS.md` §10), integrated on `wt/p3-integration`; notes in
`docs/agent-notes/p3-*.md`.
- **P3-B domain** — camera presets for every knowledge pack, camera helpers (ids, presets,
  readiness, validation), compiler `pc-1.1.0` with a camera section and anchor references,
  anchor/production batch builders.
- **P3-A backend** — persistent job queue (`services/queue.rs`): per-provider concurrency
  (local 2, remote 1), retries 15 s / 60 s up to 3 attempts, cancel, restart recovery, events;
  batches; camera anchors; `anchor_generation` / `production` status; v2 → v3 upgrade.
- **P3-C UI** — Camera module with the Camera Director (SVG plan, drag/keyboard), Generate
  anchors / Render cameras dialogs, Contact Sheet with Approve as anchor, Jobs tray and top-bar
  queue indicator, Generate through the queue; Phase 2 race fixes.

## Phase 3 — automated checks (main after merge)
- `npm run verify` — pass: vitest 239, cargo 135 passed + 1 ignored (live Gemini), clippy
  `-D warnings`, `cargo fmt --check`, Prettier clean. Contract fixtures cover every §10 command.

## Phase 3 — not yet verified
- Camera Director, Contact Sheet and Jobs tray seen with human eyes (agent checked DOM/layout
  in the browser preview against the mock backend; screenshots were not available).
- Queue behaviour in the native app with the real backend beyond cargo tests.
- Live Gemini generation (no key on the build machine).

## Phase 2 — completed
Built in three parallel worktrees against shared contracts (`tasks/PHASE_02.md`,
ADR-012…015, `docs/API_CONTRACTS.md` §9); notes in `docs/agent-notes/p2-*.md`.
- **P2-A backend** — `secrets.rs` (OS keychain via `keyring`, env fallback, memory store
  for tests); offline deterministic `local_preview` provider; `services/generations.rs`
  (validation, `running` row, provider call without the DB lock, full decode of outputs,
  managed originals + thumbnails, one transaction for assets/versions/outputs, failure
  cleanup, `interrupted` recovery at startup); provider and generation commands;
  monotonic IDs; v1 → v2 database upgrade test.
- **P2-B Gemini adapter** — `providers/gemini/` against `generateContent`; five verified
  model ids with capabilities; prompt composition with role-labelled reference images;
  typed error mapping; key redaction on every path; sequential calls for several outputs
  with partial-failure handling; mock-server tests plus one ignored live smoke test.
- **P2-C UI** — Generate module (provider/model, Hero/Variation, capability-driven params,
  ordered reference checklist, prompt preview, running state, results, Use as master,
  Retry), provider settings dialog + top-bar chip (key never kept in app state), History
  tab, Versions lineage tree, mock backend parity.
- **Contract fixtures** — the real Rust services write JSON for every Phase 2 command to
  `apps/desktop/tests/fixtures/backend`; vitest parses each with the bridge's Zod schema.

## Phase 2 — automated checks (last run, main after merge)
- `npm run verify` — pass: vitest 136, cargo 102 passed + 1 ignored (live Gemini),
  clippy `-D warnings` clean, `cargo fmt --check` clean.
- `tauri dev` on the integrated build — app starts, migrations reach schema v2.

## Phase 2 — not yet verified
- Live Gemini generation (no `ARCH_STUDIO_GEMINI_API_KEY` on the build machine).
- Generate flow inside the native window with the real backend (verified in the browser
  preview against the mock backend and by cargo tests).
- Codex reviews still pending (see Current phase).

## Phase 1

## Completed
- Architecture handoff package prepared.
- UI/UX Shell specification added as a formal Phase 1 requirement.
- **P1-01 Scaffold** — npm workspaces, Tauri 2 + React 19 + TS + Vite, ESLint, Prettier,
  Vitest, cargo tests, `.gitignore` for runtime data.
- **P1-02 Domain schemas** — Zod enums, Building/Context DNA, future Camera/Lighting/
  Weather/Mood/ColorGrade, LockState, ProjectDNA, PromptBundle, DTOs; JSON Schema export.
- **P1-03 SQLite + migrations** — `0001_initial.sql` (projects, project_dna, assets,
  versions), forward-only runner, fresh-DB and reopen tests, newer-schema refusal.
- **P1-04 Knowledge Packs** — townhouse (default, narrow_lot), single-storey house, villa
  (default, tropical), urban villa, prefab/modular, interior (default, living_room),
  custom fallback; resolver with exact → type default → custom fallback.
- **P1-05 Project services** — create (atomic, folder rollback), list, get, update
  metadata, archive/restore, approve master; derived status (ADR-009).
- **P1-06 Project Hub** — cards with thumbnail/master badge/status/updated time, search,
  active/archived/all filter, archive (confirm) / restore, loading/empty/error/no-result.
- **P1-07 Workspace shell** — top bar (save state, status, archive), permanent left nav,
  center canvas with Canvas / Prompt Preview tabs, contextual right panel, collapsible
  bottom tray (Assets, Versions, Jobs, History).
- **P1-08 Image canvas** — fit, zoom buttons + wheel around cursor, pan when zoomed, 1:1,
  dimensions overlay, missing-file recovery state; only the selected original is loaded.
- **P1-09 New Project Wizard** — 4 short steps (basics, architecture, context starter,
  summary); only the name is required.
- **P1-10 DNA editor** — Building + Context panels with collapsible sections, tag lists,
  materials table, lock toggles; Zod validation per keystroke, debounced autosave,
  Saved/Unsaved/Saving/Fix-fields/Error indicator, flush on module switch, hub and window
  close.
- **P1-11 Asset import** — JPEG/PNG/WebP sniffed by content, dimensions, MIME, size,
  SHA-256, managed copy via `.part` + rename, thumbnail, root version, rollback.
- **P1-12 Asset library** — tray strip with role filter, import-as role, multi-import,
  drag & drop, duplicate prompt, property panel (metadata, role, master, safe remove).
- **P1-13 Prompt compiler** — deterministic, provider-neutral, sectioned; tests for
  determinism, order independence, clean optional output, type differences, role
  instructions.
- **P1-14 Prompt Preview** — positive/negative/reference/preservation/metadata blocks,
  copy buttons, compiler version; compiled from persisted data only.
- **P1-15 Future states** — Camera, Lighting, Mood/Grade, Generate, Enhance, QC, Export,
  Jobs, History show explicit "coming in Phase N" placeholders; Versions shows import
  lineage.

## Automated checks (last run)
- `npm run typecheck` — pass
- `npm run lint` — pass
- `npm test` — 70 tests pass (42 domain, 28 desktop)
- `cargo test` — 28 tests pass; `cargo clippy --all-targets` — 0 warnings
- `npm run build -w @arch/desktop` — pass
- `tauri dev` — app launches, database + migrations created in the data folder

## Not yet verified
- Full manual scenario P1-16 inside the native Tauri window (image import via the OS
  dialog, canvas zoom/pan on real files, close/reopen, 1366×768). UI flows were exercised
  in the browser preview with the mock backend; backend flows by cargo tests.

## Blocked
- None.

## Notes
Update this file after each meaningful milestone.
