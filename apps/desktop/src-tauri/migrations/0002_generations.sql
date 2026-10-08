-- Phase 2: provider-neutral generation history and generated-output lineage.
-- request_json is the exact provider-neutral request snapshot (prompt bundle, ordered
-- reference asset IDs, params). It never contains API keys or vendor request bodies.

CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL,
  request_json TEXT NOT NULL,
  parent_asset_id TEXT,
  error_kind TEXT,
  error_message TEXT,
  error_retryable INTEGER,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_asset_id) REFERENCES assets(id) ON DELETE SET NULL
);

CREATE INDEX idx_generations_project ON generations(project_id, started_at);
CREATE INDEX idx_generations_status ON generations(status);

-- Output order of each generation. Removing an output asset removes only its row here;
-- the generation record stays in history.
CREATE TABLE generation_outputs (
  generation_id TEXT NOT NULL,
  output_index INTEGER NOT NULL,
  asset_id TEXT NOT NULL,
  PRIMARY KEY (generation_id, output_index),
  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE INDEX idx_generation_outputs_asset ON generation_outputs(asset_id);

ALTER TABLE versions ADD COLUMN generation_id TEXT REFERENCES generations(id) ON DELETE SET NULL;
