# Imported-image workflow and Blueprint branding

Date: 2026-10-21. Baseline: main d01a191. Direct follow-up to the owner's screenshot.

## Changes

- Every project asset appears in Node immediately, including ordinary external images and
  references that have never participated in a generation. Loading saved node positions
  precedes mounting React Flow, so its initial Fit View uses the real layout.
- Selecting an import or tray tile also selects its graph node; graph multi-selection and
  explicit toolbar actions retain their existing selection behavior.
- Tray card layout now budgets for checkbox, thumbnail, metadata and compare action. Short
  windows have a 160px tray; large cards remain scrollable. Portraits use contain in the
  tray and Node thumbnail, showing both ends without cropping.
- Shared field instructions live behind keyboard-accessible `?` popovers. Source, preset,
  saved-preset, extra-prompt and recipe explanations no longer occupy the default panel.
  Validation errors, job state and cost/billing warnings remain visible.
- Ready imported images enable Enhance, Region edit, colour grading and image variation
  without becoming Master. UI, mock and Rust gates agree. Missing files, videos, archived
  projects, ownership checks and spend confirmation retain their guards. Anchor/production
  workflows still require their DNA/Master prerequisites. Output lineage remains immutable.
- The owner supplied the Option C / Blueprint Studio reference board. Its brand text is
  **IMAGE-CREATIVE-ARCHITECT**. SVG assets redraw the cyan/violet arch, towers and sparkle;
  header wordmark, favicon, title, native icons and installer product name use this identity.
  The application identifier stays `com.archaistudio.desktop`, preserving the existing data location.

## Verification

- Typecheck, ESLint, Prettier, Vite build: pass.
- Vitest: 102 files, 1141 tests pass.
- Rust on Windows: 367 pass, 6 live-provider tests ignored. Clippy `-D warnings`: pass.
- Regression tests failed before the fixes for standalone imports, selected-image editing,
  selection sync, hidden help and initial node Fit View.
- A local conservative-enhance test now uses a regular external image with no Master approval;
  it verifies unchanged source bytes, output dimensions and version lineage.
- Browser QA uses Chromium headless and an isolated mock backend, not paid AI calls.
  It checks initial imported-node fit, tray→Node selection, portrait card containment,
  resize 1920→1280→1000→800→960→1920, editing without Master, real fullscreen/WebM playback,
  preserved scroll/draft and no write commands from selection/viewing. `asset_preview` is a read.

Run `npm run test:ui` after `npx playwright install chromium`.
Artifacts default to the session temp directory; set `QA_OUTPUT_DIR` for a chosen location.
Measurements and selected screenshots are committed alongside this report.

## Limits

The SVG is a scalable implementation of the supplied board, not a crop of that image.
Native WebView2 window interactions and provider video files still need manual QA; browser
checks do not claim to simulate real Windows Display Scale. No source files or user project
data were overwritten, and no provider credentials were used by tests.
