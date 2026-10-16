-- SRS P5b (ADR-038): Publishing Studio books. `json` is the publication document
-- ({ publication, facts }) validated against packages/domain/schema/publication-document.schema.json.
-- Images are pinned inside the JSON by assetId + sourceHash, so there is no asset foreign key:
-- removing an asset never rewrites an old publication (the validator reports it instead).
CREATE TABLE publications (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_publications_project ON publications(project_id, updated_at);
