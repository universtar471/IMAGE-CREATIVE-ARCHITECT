# P2-C — UI: Generate module, provider settings, History, Versions lineage

Branch `wt/p2-ui`. Read these first:
- `tasks/PHASE_02.md`, ADR-012…015, `docs/API_CONTRACTS.md` §9
- `docs/UI_UX_SPEC.md`
- `packages/domain/src/schemas/generation.ts`
- the existing shell (`features/workspace`, `features/assets`, `app/store.ts`, `lib/bridge.ts`, `lib/mockBackend.ts`)

You own `apps/desktop/src/**`, `apps/desktop/tests/**` and `packages/domain/**`.
Do not touch `src-tauri`. The backend lands in parallel, so build against the §9 contract
and the mock backend.

## Scope

1. **Bridge**
   - Add the seven §9 commands to `Requests` / `responses`, parsed with the domain schemas.
   - `VersionDTOSchema` gains `generationId: z.string().nullable()`.
   - `PROVIDER_NOT_CONFIGURED` must surface as a friendly message with a "Set API key" action.

2. **Mock backend** (browser preview + tests): implement the same commands with the same validation rules.
   - Providers: `gemini` (unconfigured until a key is "set"; store only a boolean, never the string) and `local_preview`.
   - `generation_submit` creates generated assets (any cheap placeholder image the mock can display), versions with lineage, and history rows.
   - Simulate a short delay.
   - A prompt containing `[fail]` returns a `failed` generation, so the error UI is testable.

3. **Domain helpers** (pure, tested, in `packages/domain`):
   - default reference selection for a model:
     - master first, then the other roles in `REFERENCE_ROLE_ORDER`
     - only `ready` assets
     - capped at `maxReferenceImages`
     - none when the model lacks `imageToImage`
   - default params from `ModelCapabilities`
   - client-side validation that mirrors §9

4. **Generate module**
   - In `modules.ts` set `availableIn: null`.
   - **Canvas:**
     - shows the selected output, or the master, or an empty state
     - the reused ImageViewer
   - **Right panel:**
     - provider + model selects (only configured providers are enabled; others show "Set API key")
     - purpose (Hero is the default when a master exists; otherwise Variation)
     - aspect ratio / image size / output count / seed, each only when the model supports it
     - reference checklist with role badges and thumbnails, in order, with the cap shown
     - a collapsible compiled-prompt preview (reuse `compilePromptPreview`: persisted data only, flush DNA first)
     - DNA readiness warning (allowed, but warned)
     - a Generate button with the disabled reason in text
   - **Running state:**
     - spinner and elapsed time
     - the user can switch modules
     - the result still lands even if the user navigated away
     - a result for another project is ignored safely
   - **Result:**
     - output thumbnails
     - "Use as master" (`asset_set_master`, confirm when it replaces an existing master)
     - "Show in References"
     - "Generate again"
     - Failed → error kind + message + Retry.

5. **Provider settings dialog**
   - Opened from the top bar (a provider-state chip) and from the Generate panel.
   - Lists providers with the configured badge and key source.
   - A password input whose value is cleared after Save. Clear key (confirm). Test connection, showing the result.
   - The key string must never be put in zustand, localStorage, console output or React state beyond the input's own lifetime.

6. **History tray tab**
   - In `TRAY_TABS` set `availableIn: null`.
   - Newest first; each entry shows status, purpose, provider/model, time, duration, output thumbnails and the error.
   - "Reuse settings" loads the provider/model/params/references into the Generate panel.
   - Clicking an output selects it in the canvas.

7. **Versions tray tab**
   - Show a lineage tree built from `parentVersionId`; generated versions show their generation.
   - Update the tab note text.

8. Jobs stays a Phase 3 placeholder.

9. **Tests** (vitest): domain helpers; bridge parsing; mock backend generation flow, including the failure path and `PROVIDER_NOT_CONFIGURED`; store flow (submit → assets/versions/history refreshed; project switch while running).

## Done when

- `npm run verify` is green from the repo root.
- The browser preview works with the mock backend, checked by you if browser tools are available. Use port 1421 to avoid clashing with other previews: `npm --prefix <worktree>/apps/desktop run dev -- --port 1421 --strictPort`.
- It is usable at 1366×768.
- `docs/agent-notes/p2-ui.md` is written.
- Small commits on `wt/p2-ui`.

Do not build the job queue, camera, lighting or enhancement UI.
