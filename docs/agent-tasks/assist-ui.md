# AI assist UI, tidy Space panel, preset photos (ADR-030, API §20.3–20.4)

**Branch:** `wt/assist-ui`.

**You own:**
- `apps/desktop/src/**`, except `lib/mockBackend.ts`
- `apps/desktop/tests/**`, except `tests/fixtures/backend`
- `apps/desktop/public/previews/manifest.json`. Only the schema and loader matter; the lead adds the images.

## Domain stand-ins

`assistCatalog`, `parseAssistReply`, `applyAssistFields`, `assistSystemPrompt` and `containsVietnamese` are being built on `wt/assist-core`. Until they land:
- Put minimal stand-ins with the exact §20.1 signatures in `apps/desktop/src/lib/assist.ts`, marked `TODO(assist-core)`.
- Route every import through that one file.
- Call the `dna_assist` command through the normal services layer. In tests, stub it.

## Read first

- ADR-027, ADR-028, ADR-029 and ADR-030.
- API §18, §19 and §20.
- `features/dna/InteriorDnaPanel.tsx` and the moodboard, `features/dna/*`, `features/lighting`, `features/generate/MasterDnaCheck.tsx`, `components/common/SpendConfirm`.
- `components/panels/PropertyPanel.tsx`, `features/previews/*`, `i18n/{vi,en}.ts`.

## Scope

1. **Space panel layout** (the bug in the user's screenshot). The moodboard sits beside the fields in the narrow panel, so the selects are about 50 px wide, labels are cut ("Ph…", "Jap…") and "VẬT LIỆU BỀ MẶT" breaks over 4 lines.
   - Below 560 px the moodboard stacks above the fields (container query or ResizeObserver), and the fields are full width.
   - Collapsible groups: Không gian · Phong cách & bảng màu · Vật liệu bề mặt · Đồ nội thất · Ánh sáng.
   - Surface materials and furniture become chips. One row per surface; the first selected chip is marked "chính" (primary), and the order is kept.
   - Section titles are normal case and never break mid-word.
   - Tests: structural layout at 340 px and 640 px widths, chips order and primary.
2. **Resizable right panel.** Drag handle, 320–720 px, remembered in `localStorage` (try/catch), with keyboard support.
3. **AI gợi ý**, per §20.3.
   - The button and popover with the three source modes, in the Space, Kiến trúc, Bối cảnh and Ánh sáng steps.
   - Spend confirmation before the call.
   - The diff sheet: checkboxes, confidence badge, reason, dropped list, and "Áp dụng N mục".
   - On a confirmed step, ask to reopen first.
   - The translate chip on free-text fields with Vietnamese.
   - "Đồng bộ DNA từ Master" in MasterDnaCheck.
   - Error states:
     - not configured: link to provider settings
     - out of credit: "Hết credit HHTECH — nạp thêm để dùng AI gợi ý"
     - invalid reply
   - Tests: each mode builds the right request; apply writes only the checked fields; the reopen prompt; the translate chip appears only for Vietnamese text; the error messages.
4. **Preset photos**, per §20.4.
   - `previewPhoto(kind, id)` reads `public/previews/manifest.json`.
   - Lighting, mood, context and interior style cards and options show the photo when present, else the existing SVG.
   - Interior projects prefer the `_interior` kinds.
   - Lazy loading, with alt text.
   - Commit a manifest with `items: {}`. Tests use a fixture manifest.
5. **Strings:** vi with diacritics, and en. Keep i18n parity and the diacritics guard. No raw keys rendered: add a test that renders the new UI and asserts no text matches `/^[a-z]+(\.[a-zA-Z]+)+$/`.

## Done when

- `npm run verify` is green.
- `npx prettier --check .` is clean.
- `docs/agent-notes/assist-ui.md` is written and lists the stand-ins.
