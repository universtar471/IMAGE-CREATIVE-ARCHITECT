# Review: ui-generate

**Verdict: ĐẠT.** Merged into main; the lead mounted `QuickGenerateView` in `CreateSectionView` and made projects open in the create section.

- Lead verify on main: typecheck and lint clean, prettier clean, vitest 1070 of 1073 pass. The three failures (`hhtechModels`, `publishing`, `sketchMode`) were 5 s timeouts while another agent was building Rust; all pass on rerun (27 of 27).
- The submit path is shared through `useGenerateSubmit`, so the gate and spend confirmation are the same as in `GeneratePanel`.

## NÊN SỬA (later)

- Faithfulness is mapped to which references are sent, since generation has no strength setting. Revisit if a provider exposes image strength.
- Drag and drop from the OS into the drop zone is not wired (needs the Tauri drag-drop event).
- No "Enhance prompt" button on the quick screen.
- The source and faithfulness choice live in component state; they reach the draft only through "Tùy chỉnh đầy đủ".
