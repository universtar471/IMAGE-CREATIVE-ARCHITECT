# UI generate — quick-generate screen (ADR-040, UI-3)

**Branch:** `wt/ui-generate`.

## Read first

- ADR-040 and ADR-034 amendment 3 (gate) in `docs/DECISIONS.md`.
- `apps/desktop/src/features/generate/**`, `features/validation/{ConflictPanel.tsx,gate.ts}`, `components/common/SpendConfirm*`, `features/assets`, and the reference roles in the store and services.

## Scope

1. **`QuickGenerateView`** in `features/generate/quick/`, exported for the lead to mount. Do not edit the nav or `ProjectWorkspace.tsx`.
   - Left, about 2/3: source cards (Từ ảnh có sẵn / Từ phác thảo / Từ mô tả) and the large source image, or an empty drop zone that tells the user the next step.
   - Right, about 1/3: the request panel.
2. **Sources.** Pick an existing asset or import a file through the existing import path. Map Từ phác thảo to the existing sketch reference role if one exists. Hide any source the current pipeline cannot serve and say so in the note.
3. **Request panel.**
   - Wish textarea; the text goes to the extra prompt.
   - Faithfulness (keep source / balanced / creative) mapped to existing generation settings.
   - Aspect; image count (default 1 test image).
   - Read-only "Thiết kế cần giữ" summary from the DNA.
   - Advanced options collapsed. A "Tùy chỉnh đầy đủ" link opens the existing `GeneratePanel`.
4. **Plan dialog.** "Xem kế hoạch tạo ảnh" shows a summary, the cost estimate and the exception panel. Confirming submits through the same code path as `GeneratePanel`: extract that path into a shared hook instead of duplicating it.
5. **Slot for analysis.** Under the image, render an optional `analysisSlot` prop (UI-5 plugs its card in there) and the collapsible compiled prompt (`GeneratePromptPreview`).
6. Strings in Vietnamese with full diacritics, and in English.

## Tests

- Empty state; each source mode; the wish lands in the extra prompt; the plan dialog shows the cost and blocks on BLOCK; a WARN asks for approval; submit calls the same service as `GeneratePanel`; the image count defaults to 1.

## Out of scope

- Nav, sections and library (`wt/ui-shell`), `dna_assist` (`wt/ui-source-assist`), the wizard, Rust.

## Done when

- `npm run verify` and `npx prettier --check .` pass.
- `docs/agent-notes/ui-generate.md` is written.
- Do not commit. Do not touch `.env`. Make no paid calls.
