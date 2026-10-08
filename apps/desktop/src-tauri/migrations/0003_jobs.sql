-- Phase 3: job queue, batches, camera anchors (ADR-016..018).
-- A job runs exactly one generation; retries are attempts of the same job and generation.
-- Camera definitions live in project_dna (DNA aggregate); anchors are backend facts here so
-- removing an asset can never leave a dangling anchor.

CREATE TABLE batches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_batches_project ON batches(project_id, created_at);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  batch_id TEXT,
  generation_id TEXT NOT NULL UNIQUE,
  provider_id TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TEXT,
  error_kind TEXT,
  error_message TEXT,
  error_retryable INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE,
  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE
);

CREATE INDEX idx_jobs_pick ON jobs(status, priority DESC, created_at, id);
CREATE INDEX idx_jobs_project ON jobs(project_id, created_at);
CREATE INDEX idx_jobs_batch ON jobs(batch_id);

ALTER TABLE generations ADD COLUMN camera_id TEXT;
ALTER TABLE generations ADD COLUMN batch_id TEXT REFERENCES batches(id) ON DELETE SET NULL;

CREATE TABLE camera_anchors (
  project_id TEXT NOT NULL,
  camera_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  PRIMARY KEY (project_id, camera_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);
