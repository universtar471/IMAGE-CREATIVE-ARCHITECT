# Review: wt/srs-p5a (ADR-038 P5a)

**Verdict: ĐẠT. Merged.**

Codex started this work before the Volibear credit ran out. A Claude subagent finished it and fixed four problems in the Codex work:
- image groups were invented
- randomize moved text slots into image frames
- an old seed did not restore the old result
- the validator had its own private types

## Lead verification (after merging main)

- vitest: 74 files, 895 tests pass.
- typecheck, lint and prettier are clean.
- Only domain code changed; there are no Rust changes.

## NÊN SỬA (P5b or later)

- A style change applies to the whole book, so it also re-styles locked pages. Their content and layout stay unchanged.
- Titles go through the fact detector. For example, "Nhà phố Quận 7" needs a `factRef`.
- In `include_all` mode, no validator code catches an image placed twice.
- Overflow is estimated from the character count, not measured.
