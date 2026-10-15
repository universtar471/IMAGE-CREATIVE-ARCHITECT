# Review: AI DNA assist, Space panel and preset photos (ADR-030)

Branch: `wt/assist-integrate`, which merges `wt/assist-core` and `wt/assist-ui`.
Verdict: **ĐẠT** (pass).

## Verification (run by the lead)

- `npm run verify`: typecheck, lint, 556 JS tests, 272 Rust tests (6 ignored).
- `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` are clean.
- `npx prettier --check .` is clean.

## Checked

**API key safety (ADR-013)**
- `services/dna_assist.rs` stores only mode, scope, reference count and model in `request_json`.
- The key is read through `provider_settings::key_for` and never enters DTOs, logs or error text.

**Inputs**
- Mode and scope are allow-listed.
- Limits: brief 1,000 characters, at most 3 references, system prompt 20,000 characters, each translate item 2,000 characters.
- References must belong to the project. Master mode requires an approved master.
- Images are downscaled to at most 1024 px JPEG before being sent.

**Apply**
- `applyAssistFields` skips `__proto__`, `constructor` and `prototype` path parts.
- It re-parses the whole DNA with `ProjectDNASchema`.
- The UI applies only the rows the user ticks.

**Compiler pc-1.6.0**
- Primary and accent materials are covered by tests.
- Missing or unknown interior camera presets fall back to the wide framing.
- Each preset keeps its own text.

**Preview photos**
- 48 WebP files (1.5 MB) and the manifest.
- The loader only accepts `previews/<kind>/<id>.webp` sources.
- It falls back to the SVG previews.

## NÊN SỬA (should fix, not blocking)

1. `packages/domain/src/interior/helpers.ts` (`addSurfacePrompt`): accent text only strips a trailing "flooring". Wall accents read "soft limewash walls accents". Strip the slot noun generically.
2. `dna_assist` accepts a `systemPrompt` from the webview, as designed in API §20.2. This is acceptable because the webview is trusted app code. If the webview ever loads remote content, move prompt building to Rust.
3. The `u4` agent run used about 1.6M tokens for a small task. Keep tasks narrow.
