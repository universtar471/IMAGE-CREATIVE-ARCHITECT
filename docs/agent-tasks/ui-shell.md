# UI shell — five-section navigation (ADR-040, UI-1 + UI-2)

**Branch:** `wt/ui-shell`.

## Read first

- ADR-040 in `docs/DECISIONS.md`.
- `apps/desktop/src/features/workspace/{modules.ts,ProjectWorkspace.tsx}`, `components/shell/WorkspaceNav.tsx`, `components/panels/PropertyPanel.tsx`, the bottom tray (`features/assets`, `versions`, `jobs`, `history`), `lib/workflow.ts`, `app/store.ts`.

## Scope

1. **Sections.** Add a section registry (`create`, `library`, `edit`, `present`, `studio`) in `modules.ts`, mapping each section to its modules in ADR-040 order. Keep each section's last module in the store (never in the DNA).
2. **Nav.** `WorkspaceNav` shows the five sections with icons and Vietnamese and English labels. "Studio nâng cao" is separated at the bottom. Inside Studio, a secondary list shows its nine modules with the existing step numbers and workflow status icons. The interior label rule for `design_dna` stays.
3. **Section tabs.** `edit` and `present` show a tab strip above the center area to switch modules. `setModule(id)` from anywhere selects the owning section.
4. **Ảnh của tôi.** A `library` center view:
   - asset grid with a name filter, kind and status filters, and multi-select;
   - the right panel shows the selected asset's details, reusing the existing assets, versions and history components;
   - actions: open in Chỉnh sửa ảnh, use as source in Tạo ảnh, download (existing bridge), add to publication (only if an existing hook exists; otherwise omit it and say so in the note).
5. **Tray.** Keep the bottom tray; it starts collapsed while the `library` section is open.
6. **Create section.** For now render the existing generate module through a single mount point `CreateSectionView`. The quick-generate screen comes from another branch and the lead will switch the mount.

## Tests

- The nav renders five sections; Studio lists the nine modules in order.
- `setModule("enhance")` selects `edit` and its tab; each section restores its last module.
- Library grid filters and selection; actions call the right store functions.
- Existing workspace and workflow tests stay green (update selectors only where the nav markup changed).

## Out of scope

- `features/generate/**` beyond mounting, `features/projects/NewProjectWizard.tsx`, Rust, domain schemas.

## Done when

- `npm run verify` and `npx prettier --check .` pass.
- `docs/agent-notes/ui-shell.md` is written.
- Do not commit. Do not touch `.env`. Make no paid calls.
