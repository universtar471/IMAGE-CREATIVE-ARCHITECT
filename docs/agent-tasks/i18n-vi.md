# Vietnamese UI (EN / VI switch)

Branch `wt/i18n-vi` (from main). The user, a Vietnamese architect, wants to switch the whole app UI to Vietnamese.

Read first:
- `apps/desktop/src/**` (43 components)
- `docs/UI_UX_SPEC.md`
- `packages/domain/src/knowledge/` (labels shown in the UI)
- `apps/desktop/src/lib/mockBackend.ts`

## Decisions (fixed)

- Two languages: English (`en`) and Vietnamese (`vi`). **Default `vi`** on first run; `en` if the user picks it.
- A switch in the top bar (e.g. "VI | EN") changes the language instantly, with no reload.
- The choice persists in `localStorage` key `arch.locale`, wrapped in try/catch, falling back to `vi`. It is a UI preference only; nothing goes to the backend or DB.
- No i18n library unless clearly needed. Write a tiny typed module: `apps/desktop/src/i18n/{index.ts,en.ts,vi.ts}`.
  - `en` is the source of truth: a typed object with nested keys.
  - `vi` must satisfy the same type, so a missing key is a compile error.
  - `useT()` hook, plus `t(key, params)` with `{name}` interpolation and simple plurals where needed.
  - The locale lives in a small zustand slice or context.
- **Prompts sent to AI providers stay English.** The prompt compiler output, `PromptBundle`, and anything persisted or sent to providers stay as they are. Only what the user reads changes.
  - The "Compiled prompt" / Prompt Preview panels show the English prompt (that is what is sent). Their headings and labels are translated, and a short note says the prompt is sent in English for best results.
- **Domain / knowledge labels shown in the UI** must be translated through a display-label map in the desktop app keyed by the stable ids:
  - project types and subtypes
  - styles
  - view types, camera presets
  - statuses (`master_approved`, …)
  - roles, purposes, job statuses
  - Ids, schemas and pack files do not change.
- **Backend error messages** are English text from Rust.
  - Show a Vietnamese headline per error kind/code: auth, rate_limited, blocked, invalid_request, network, timeout, bad_response, interrupted, and the AppError codes.
  - Below it, show the original provider/gateway message as detail (it often quotes the gateway, which may already be Vietnamese).
  - Do not translate inside Rust.
- Dates and numbers: `Intl` with the active locale (`vi-VN` / `en-US`). VND cost hints use the `vi-VN` grouping, e.g. "≈ 1.200đ", in both languages.
- Vietnamese copy: natural, concise, architecture-industry terms.
  - Keep common English terms Vietnamese architects use when clearer, e.g. "Render", "Master", "Anchor", "Prompt", "Batch".
  - Translate the rest, e.g. "Duyệt", "Hàng đợi", "Tham chiếu", "Mặt tiền", "Góc máy", "Tỉ lệ khung", "Chất lượng".
  - Correct diacritics and consistent terminology. Put a glossary in the agent note.
- `aria-label`s, titles, tooltips, empty states, confirm dialogs, toasts and validation messages are all translated.

## Tests

- **Type check:** `vi` matches the `en` shape.
- **Unit test:** walk both dictionaries. No empty strings; every `{param}` placeholder in `en` also appears in `vi`.
- **Component tests:**
  - Switching language updates the visible text (pick a few key screens: top bar, Generate panel, Jobs tray, provider dialog, an error display).
  - The choice persists through a remount.
- **Existing tests:**
  - They query English text. Keep them working, either by rendering in `en` inside a test setup or by updating the queries.
  - Do not weaken their assertions.
- Search for hardcoded user-visible English strings left in JSX. Add a test or script that fails on obvious leftovers if practical; otherwise list them in the note.

## Done when

- `npm run verify` green; `npx prettier --check .` clean.
- Checked in the browser preview (mock backend, port 1421, 1366×768) in both languages, if the browser tools are available. Look for overflow from longer Vietnamese strings.
- README mentions the language switch.
- `docs/agent-notes/i18n-vi.md` written, with the glossary and any strings left untranslated.
- Small commits, each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
