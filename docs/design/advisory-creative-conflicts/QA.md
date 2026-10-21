# Advisory creative conflicts — QA

2026-10-21. Reproduces the owner's Dawn + City car + Vehicle light trails combination.

Creative checks detected a motion conflict and disabled Generate. They now display optional
amber suggestions. Generation remains available without removing presets or acknowledging
exceptions. Original finding codes and verdicts remain in prompt history.

Coverage: exact preset combination opens the cost confirmation; single submit, batch and
retry retain findings without blocking. Native Rust completes an offline image with a BLOCK
assessment, queues a batch and retries with findings. Actual key/parameter/file/ownership,
archive and operation-input guards remain. Browser QA also covers model switching, missing
key, imported image source, portrait thumbnails, responsive sizing, fullscreen and video pause.

Rust: 364 pass, 6 live-provider tests ignored. Clippy with denied warnings passes.
Typecheck, lint, production build and browser QA pass. No paid provider was called.
Screenshot: preview.png; browser measurements: measurements.json.
Native Windows display scaling is not simulated by browser QA.

Vitest: 103 files, 1,153 tests passed. Exact preset regression failed before the fix.
Browser result: creativeConflictDoesNotBlock=true, noWrites=true.
