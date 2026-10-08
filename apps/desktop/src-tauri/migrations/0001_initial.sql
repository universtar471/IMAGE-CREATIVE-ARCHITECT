-- Phase 1 schema: projects, DNA, assets, versions.
-- Business relationships use stable string IDs (PRJ_/AST_/VER_ + ULID), never row numbers.
-- projects.active_master_asset_id has no FK (would be cyclic with assets.project_id);
-- the "master belongs to this project" invariant is enforced by the asset service.

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  project_type TEXT NOT NULL,
  subtype TEXT,
  status TEXT NOT NULL,
  active_master_asset_id TEXT,
  master_approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE project_dna (
  project_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  dna_json TEXT NOT NULL,
  compiler_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',

  original_name TEXT,
  managed_rel_path TEXT NOT NULL,
  thumbnail_rel_path TEXT,
  mime_type TEXT,
  file_size_bytes INTEGER,
  width_px INTEGER,
  height_px INTEGER,
  sha256 TEXT,

  parent_asset_id TEXT,
  operation TEXT,
  operation_json TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_asset_id) REFERENCES assets(id) ON DELETE SET NULL
);

CREATE INDEX idx_assets_project ON assets(project_id);
CREATE INDEX idx_assets_parent ON assets(parent_asset_id);
CREATE INDEX idx_assets_sha256 ON assets(sha256);

-- At most one master_architecture asset per project, enforced by the database as well.
CREATE UNIQUE INDEX idx_assets_one_master
  ON assets(project_id) WHERE role = 'master_architecture';

CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  parent_version_id TEXT,
  label TEXT,
  operation TEXT NOT NULL,
  operation_json TEXT,
  created_at TEXT NOT NULL,

  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_version_id) REFERENCES versions(id) ON DELETE SET NULL
);

CREATE INDEX idx_versions_project ON versions(project_id);
CREATE INDEX idx_versions_asset ON versions(asset_id);
