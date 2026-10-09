CREATE TABLE qc_reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  report_json TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('pass', 'warn', 'fail', 'unscored')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE INDEX idx_qc_reports_project_asset_created
  ON qc_reports(project_id, asset_id, created_at);

CREATE TABLE qc_settings (
  project_id TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
