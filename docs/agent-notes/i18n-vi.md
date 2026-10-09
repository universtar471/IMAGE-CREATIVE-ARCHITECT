# wt/i18n-vi — Vietnamese UI with a VI | EN switch

- Agent: claude
- Branched from: main
- Brief: `docs/agent-tasks/i18n-vi.md`

## Goal

Whole desktop UI in Vietnamese (default) or English, switchable instantly; prompts sent to
providers stay English.

## Done

- `apps/desktop/src/i18n/`
  - `index.ts`: typed dictionaries, `useT()` (re-renders on switch), `t()` for plain modules,
    `{name}` placeholders, `{ one, other }` plurals by `count`, zustand locale store,
    `localStorage["arch.locale"]` in try/catch, default `vi`.
  - `en.ts` (source of truth), `vi.ts` (typed `Dict`: a missing or extra key fails `tsc`).
  - `domain.ts`: domain validation messages translated by pattern (domain package untouched);
    headline per AppError code / provider error kind; readiness labels by stable key.
  - `knowledge.ts`: Vietnamese text for pack labels/descriptions, context presets
    (`<type>/<subtype>/<id>`), camera presets (by id), style suggestions (by English value);
    English pack text is the fallback for new packs.
  - `nodes.tsx`: fill `{name}` with React nodes (keeps the translator's word order).
- `LocaleSwitch` (VI | EN) in the Project Hub header and the workspace top bar; `<html lang>`
  follows the language.
- `ErrorMessage`: translated headline badge + original backend/provider text. Toasts get a
  `title` (headline) above the original `message`; `notifyError(err)` in the store.
- Every screen converted: hub, wizard, shell/nav/tabs, canvas viewer, Overview, Design DNA,
  Context, References + Assets tray, Prompt Preview, Generate (+ extra prompt, result),
  History / Jobs / Versions, provider chip + dialog (key help notes are dictionary keys),
  Camera panel, batch dialog, Contact Sheet, Camera Director.
- Dates via `Intl` (`vi-VN` / `en-US`), sizes via `Intl.NumberFormat`; VND cost hints keep
  the domain's `≈ 1.200đ` in both languages.
- Prompt text shown as is (`<pre lang="en">`) with a note that prompts go out in English.
  DNA / Context panels and the extra prompt suggest typing values in English.
- Layout check at 1366×768 (headless Chrome over CDP against the mock server on :1421):
  fixed the "Set API key for …" button overflowing the Generate panel (also broken in EN),
  shortened two Vietnamese labels.
- README section "Language (Tiếng Việt / English)".

## Tests

- `tests/setup.ts` puts every test in English, so existing tests and assertions are unchanged.
- `tests/i18n.test.ts`: same keys, no empty strings, every `{param}` of EN present in VI;
  translate/plurals; locale default, persistence, junk value; domain message + error
  headlines; `vi-VN` number/relative time.
- `tests/i18nSwitch.test.tsx`: switch on top bar, Generate panel (prompt stays English),
  Jobs tray, provider dialog + key help, provider error headline; first-run Vietnamese;
  choice survives a remount.
- `tests/hardcodedStrings.test.ts`: raw-glob scan of all components for English JSX text and
  literal `title / aria-label / placeholder / label / confirmLabel / hint / message / alt`.

```bash
npm ci
npm run verify          # typecheck + lint + vitest + cargo test
npx prettier --check .
npm run dev -w @arch/desktop -- --port 1421 --strictPort   # mock backend in a browser
```

Last run: verify green (vitest 22 files / 295 tests, cargo 219 passed / 5 ignored),
prettier clean.

## Left as is (on purpose)

- Backend/Rust messages stay English (shown as detail under a Vietnamese headline), incl.
  provider test messages, duplicate-import message, file-cleanup warnings.
- Data, not UI: provider and model labels, job labels (`Front — anchor`), camera names
  (presets create cameras with the English preset label — it is DNA and goes into prompts),
  DNA values and pack default values shown in the wizard, batch names already stored.
  New batch default names are localized (`Anchor …` / `Sản xuất …`).
- Field placeholders keep English sample values (`VD: Modern tropical`) because the value
  goes into the English prompt.
- `WORKSPACE_MODULES[].label` / `TRAY_TABS[].label` keep the canonical English names the
  IA test checks; the UI reads `modules.<id>.*` / `tray.<id>` from the dictionaries.
- An unknown provider error kind is shown as its raw code (existing test expects that).
- Native Tauri `ask()` buttons on close and `window.confirm` use OS/webview button text.

## Pitfalls

- Dictionary keys are dotted paths: never put a dot inside a key (readiness keys are mapped
  in `domain.ts` instead).
- `useT()` is what makes a component re-render on a switch; pure helpers (`form.ts`,
  `batch.ts`, `extraPrompt.ts`, `format.ts`) use `t()` and are re-run by their caller's render.
- `lib/bridge.ts` already has a local `t` (transport) — the import is `t as tr` there.
- The preview banner overlaps the top-bar queue indicator / hub search in the browser
  preview in both languages (pre-existing, browser preview only).

## Glossary (EN → VI)

| English | Tiếng Việt |
|---|---|
| Project / Project Hub | Dự án / Danh sách dự án |
| Archive / Restore / Archived | Lưu trữ / Khôi phục / Đã lưu trữ |
| Design DNA | DNA thiết kế |
| Context | Bối cảnh |
| References / reference | Tham chiếu / ảnh tham chiếu |
| Master (architecture) | Master / Kiến trúc Master |
| Anchor / anchor view / anchored | Anchor / góc Anchor / đã có Anchor |
| Camera (module, camera) | Góc máy |
| Camera Director | Bố trí góc máy |
| Contact Sheet | Bảng ảnh |
| Generate / Generate hero / variation | Tạo ảnh / Tạo ảnh Hero / Biến thể |
| Render cameras | Render các góc máy |
| Batch | Batch |
| Prompt / Prompt Preview / Compiled prompt | Prompt / Xem Prompt / Prompt đã biên dịch |
| Positive / Negative prompt | Prompt chính (positive) / Negative prompt |
| Extra prompt / Enhance prompt | Prompt bổ sung / Cải thiện prompt |
| Provider | Nhà cung cấp |
| Queue / Jobs / History / Versions | Hàng đợi / Tác vụ / Lịch sử / Phiên bản |
| Assets (tray) | Ảnh |
| Canvas | Khung xem |
| Aspect ratio / Image size / Quality | Tỉ lệ khung / Kích thước ảnh / Chất lượng |
| Azimuth / Elevation / Lens / Distance | Góc phương vị / Góc ngẩng / Tiêu cự / Khoảng cách |
| Composition | Bố cục |
| Facade / FRONT FACADE | Mặt tiền / MẶT TIỀN |
| Front elevation (preset) | Mặt đứng chính |
| Aerial | Chim bay |
| Massing / Voids / Cantilever | Khối tích / Khoảng rỗng / Phần đua (console) |
| Roof / Pitch / Overhang | Mái / Độ dốc / Độ vươn mái |
| Openings / Glazing | Cửa & lỗ mở / Kính |
| Negative constraints | Ràng buộc loại trừ |
| Knowledge pack | Gói tri thức |
| Approve / Withdraw approval | Duyệt / Rút lại duyệt |
| Townhouse / Single-storey house / Villa | Nhà phố / Nhà cấp 4 / Biệt thự |
| Prefab / modular | Nhà lắp ghép / module |
| Draft / DNA ready / Master approved | Bản nháp / DNA sẵn sàng / Đã duyệt Master |
| Lighting / Mood / Grade / Enhance / Export | Ánh sáng / Mood / Chỉnh màu / Nâng cấp / Xuất |
| Queued / Running / Retrying / Failed / Interrupted | Trong hàng đợi / Đang chạy / Đang thử lại / Thất bại / Bị gián đoạn |
| OS credential store | Kho mật khẩu của hệ điều hành |

Kept in English on purpose: Render, Master, Anchor, Prompt, Batch, Hero, DNA, QC, Seed,
Model, API key, Mood, Upscale, product names.
