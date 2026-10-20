-- Phase B1 (ADR-043): the provider task of a video generation, written right after the
-- provider accepted it. Polling resumes from this row after Retry or an app restart, so a
-- clip is never submitted (and billed) twice. The row is removed once the clip is stored or
-- the provider reports failure. Additive: no existing table changes. A video asset is an
-- `assets` row whose mime type is video/*; its duration lives in `operation_json`.

CREATE TABLE video_tasks (
  generation_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  task_json TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  last_polled_at TEXT,
  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
);
