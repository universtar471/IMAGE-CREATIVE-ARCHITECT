-- M3 (ADR-041): node positions of the branch canvas, one row per project. The graph itself is
-- derived from generations and assets; `json` is `{ "version": 1, "positions": { nodeId: { x, y } } }`.
CREATE TABLE canvas_layouts (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
