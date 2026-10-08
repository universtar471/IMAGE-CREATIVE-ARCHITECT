# wt/p2-ui — P2-C UI (Generate, provider settings, History, Versions)

- Agent: claude
- Branched from: main (3ead73d, Phase 2 contracts)
- Brief: `docs/agent-tasks/p2-ui.md`

## Goal

Phase 2 frontend against the §9 contract: typed bridge commands, mock backend, pure domain
helpers, the Generate module, the provider settings dialog, and the History / Versions tray
tabs. `src-tauri` was not touched.

## Done

- **Domain** (`packages/domain/src/generation/helpers.ts`): `defaultReferenceIds`,
  `orderReferences` / `orderReferenceIds`, `defaultGenerationParams`, `adaptGenerationParams`,
  `validateGenerationRequest` (mirror of the §9 VALIDATION_ERROR rules),
  `generationParentAssetId` (ADR-015 anchor). Tests: `packages/domain/tests/generation.test.ts`.
- **Bridge**: the seven §9 commands are in `Requests` / `responses`, parsed with the domain
  schemas. `VersionDTOSchema.generationId` added. `providerNeedingKey(err, fallback)` maps
  `PROVIDER_NOT_CONFIGURED` to a provider id (from `details.providerId`, else the request's).
- **Mock backend**: `gemini` (unconfigured until a key is "set"; only a boolean is stored)
  and `local_preview`. The Gemini model table mirrors P2-B's `providers/gemini/models.rs`
  (default `gemini-nano-banana-2.1`; `gemini-2.5-flash-image` has no image sizes, so
  `imageSize` is null). `generation_submit` validates like §9, persists a `running` row,
  waits `generationDelayMs` (1500 ms in the browser, configurable), then creates SVG
  placeholder outputs, versions under the parent's latest version, and the history row. A
  positive prompt containing `[fail]` produces a `failed` generation (kind `bad_response`).
  A reload with a `running` row turns it into `interrupted`.
- **Store**: `providers`, `providerDialog`, `generateDraft` (null fields = defaults),
  `run` (single run tagged with `projectId`), `workspace.generations`,
  `submitGeneration`, `reuseGeneration`, `refreshGenerations`.
- **Generate module** (`features/generate/*`), **provider dialog + top-bar chip**
  (`features/providers/*`), **History tab** (`features/history`), **Versions tree**
  (`features/versions`). Jobs stays a Phase 3 placeholder.
- Tests: `apps/desktop/tests/mockGeneration.test.ts` (bridge parsing, mock providers,
  mock generation incl. failure / PROVIDER_NOT_CONFIGURED / validation),
  `apps/desktop/tests/generateFlow.test.ts` (store flow, project switch while running,
  single run, reuse settings, form derivation, version tree).

## Decisions / deviations

1. **Default references exclude `regular_image`.** Every generated output is a regular image;
   auto-including them would feed each result into the next request. Users can still tick
   them by hand. Otherwise: master first, then `REFERENCE_ROLE_ORDER`, ready only, capped.
2. **Reference order = prompt compiler order** (role rank, then asset ID — the compiler's
   `sortReferences`). The UI submits `referenceAssetIds` in that order so "Image N" in the
   compiled prompt matches the N-th image sent. The backend should keep request order.
3. **`compilePromptPreview(projectId, referenceAssetIds?)`**: with IDs, only those ready assets
   are described as references (exactly what the generation sends). Without, unchanged.
4. **Default params**: first offered aspect ratio and image size (or null when the model
   lists none), 1 output, no seed. For Gemini this means 1:1 / 1K by default.
5. **Retry** resends the stored request snapshot (`g.prompt` unchanged). **Generate again**
   reuses the settings but recompiles the prompt from the current DNA.
6. **One generation at a time** in the UI (global `run`), even across projects. A result for a
   project that is no longer open only updates `run`; that project reloads history/assets
   from the backend when reopened.
7. **Provider select**: unconfigured providers are disabled options ("— set API key") plus a
   "Set API key for …" button. When the drafted provider loses its key, the form falls back to
   the first configured provider.
8. **API key handling**: the dialog uses an uncontrolled `<input type=password>` read via ref
   only on Save, then cleared; only a `hasInput` boolean lives in React state.
9. Mock outputs are `image/svg+xml` (no canvas needed, works in jsdom); the real backend
   stores PNG/JPEG. `durationMs` in the mock is wall-clock.

## Assumptions about backend JSON (P2-A)

- Exactly the shapes in `packages/domain/src/schemas/generation.ts`, camelCase.
- `PROVIDER_NOT_CONFIGURED` carries `details: { providerId }` (UI falls back to the request's
  provider if missing).
- `generation_list` is newest first and includes `running` rows; during our own call the
  History tab hides backend `running` rows and shows a live row instead.
- `version_list` returns `generationId` (null for imports); `parentVersionId` of an output =
  latest version of the parent asset.
- `generation_submit` is a single blocking call that returns the final DTO (ADR-014).

## Debts / follow-ups

- Hero default aspect ratio does not follow the master's aspect (1:1 by default).
- Nested ConfirmDialog inside the provider Dialog: Escape closes both (shared window listener).
- The canvas has no dedicated "generation contact sheet" mode yet; outputs are browsed via
  thumbnails in the panel/History.

## Test commands

```
npm run typecheck
npm run lint
npx vitest run            # 116 tests (domain + desktop)
npx prettier --check .
npm run verify            # green, incl. cargo test
npm --prefix apps/desktop run dev -- --port 1421 --strictPort   # browser preview (mock)
```

## Visual check (browser pane, 1366×768, mock backend)

Created a project → Generate (local preview, variation ×2) → outputs in canvas, Assets,
History, Versions → Use as master → Hero ×2 while switching to Overview (result landed) →
Versions tree shows outputs under the master version → set a dummy Gemini key (input cleared,
not in localStorage/DOM) → Gemini models/ratios/sizes shown, seed hidden → `[fail]` in DNA →
Failed card with kind + Retry → cleared key → Retry gives "Google Gemini has no API key yet"
with a "Set API key" action.

## Traps

- Bash heredocs with large Python payloads failed in this environment ("unexpected EOF");
  write scripts to a temp file first. Python text mode on Windows writes CRLF — run prettier.
- react-hooks lint flags any function named `use…` called in a callback (`useAsMaster` →
  renamed `promoteToMaster`).
