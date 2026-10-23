# AI Multi-Angle Camera Studio — M1

User request and `docs/MULTI_ANGLE_CAMERA_SPEC_V1.md` define this task's scope.
Local branch: `feature/multi-angle-camera-m1`. No push, merge, PR, publication or remote writes without explicit user approval.

Implemented:
- Orbit inside Camera; existing Studio/Node switch and History Graph retained.
- Geometry-only SVG proxy using building footprint / confirmed active-room width and depth, otherwise estimated defaults.
- Four icon presets per scope, resolved through the canonical active-space DNA rules.
- Angle/distance controls, reset to the selected camera's pose at Orbit-session entry, stable-ID camera creation.
- Canonical Camera DNA, debounced autosave, read-only handling, VI/EN and existing HelpPopover.
- Domain/DOM/browser coverage; screenshots and validation in `docs/reviews/multi-angle-m1/`.

Local follow-up tickets (not remote issues):
- M2: multi-view generation, SpendConfirm, lineage, CameraRig/ViewCollection, individual retry and contact sheet.
- M3: separate editable WorkflowCanvas with typed ports, DAG validation, persistence and runner; retain History Graph.
- M4: calibrated geometry/depth/mesh, camera collision, occlusion/QC and capability-gated start/end-frame video.

Native Tauri validation remains required on a machine with Rust/Cargo. Browser save/reopen tests use the repository's mock transport, not SQLite.

Camera synchronization follow-up: completed locally on `feature/multi-angle-camera-m1-sync`.
See ADR-052 and `docs/reviews/camera-sync/REPORT.md`. Interior Generate now references Camera
DNA; preset/pose/lock/link persistence checks are complete. Multi-view batch generation,
Workflow DAG and geometry/QC remain deferred. No remote writes authorized or performed.
