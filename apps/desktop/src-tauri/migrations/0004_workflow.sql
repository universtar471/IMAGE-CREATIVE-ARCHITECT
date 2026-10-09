-- Phase 4B: persisted confirmation state for the five DNA workflow steps.
CREATE TABLE workflow_steps (
  project_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'confirmed', 'needs_review')),
  confirmed_at TEXT,
  PRIMARY KEY (project_id, step_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Existing approved masters already passed the design pipeline before workflow states existed.
INSERT INTO workflow_steps (project_id, step_id, status, confirmed_at)
SELECT p.id, s.step_id, 'confirmed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM projects p
JOIN (SELECT 'dna.building' AS step_id UNION ALL SELECT 'dna.context' UNION ALL SELECT 'dna.references'
      UNION ALL SELECT 'dna.camera' UNION ALL SELECT 'dna.lighting') s
WHERE p.master_approved_at IS NOT NULL;
