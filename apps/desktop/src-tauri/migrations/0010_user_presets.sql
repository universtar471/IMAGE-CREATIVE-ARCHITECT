-- M2 (ADR-040): the user's saved preset combinations ("My presets"). They are app-wide, not
-- per project. `preset_ids` is a JSON array of shot preset ids from the domain catalog; ids the
-- catalog no longer knows are skipped when a combination is applied, never rewritten here.
CREATE TABLE user_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    preset_ids TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_user_presets_name ON user_presets(name);
