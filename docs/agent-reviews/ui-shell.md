# Review: ui-shell

**Verdict: ĐẠT.** Merged into main after ui-wizard.

- Lead verify on main after the merge: typecheck and lint clean, vitest 1055 of 1057 pass. The two failures (`hhtechModels`, `publishing`) were 5 s timeouts while two other agents were running; both files pass on rerun (23 of 23). No Rust change. Prettier clean.
- Scope matches ADR-040 for UI-1 and UI-2.

## NÊN SỬA (later)

- Ảnh của tôi download is the `asset_preview` PNG (max 4096 px), not the original file; add a Rust "save original" command.
- No "add to publication" action yet: the publishing store has no add-image function.
- The history panel shows project history, not history filtered to the selected asset.
- The default landing section is still Studio / Overview; it should be Tạo ảnh tự động once quick generate is mounted.
