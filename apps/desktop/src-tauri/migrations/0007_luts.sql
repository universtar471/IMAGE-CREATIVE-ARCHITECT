CREATE TABLE lut_sources (
    id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, added_at TEXT NOT NULL,
    last_scan_at TEXT NOT NULL, lut_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE luts (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES lut_sources(id) ON DELETE CASCADE,
    rel_path TEXT NOT NULL, pack TEXT NOT NULL, category TEXT NOT NULL,
    name TEXT NOT NULL, size INTEGER NOT NULL, is_log INTEGER NOT NULL DEFAULT 0,
    favorite INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('ok', 'missing', 'invalid')),
    UNIQUE(source_id, rel_path)
);
CREATE INDEX idx_luts_source ON luts(source_id);
