-- SRS P3 (ADR-035): the deterministic local enhance check, as JSON, on the generation.
-- Optional; NULL for every older row and for non-enhance generations. The QC tables of
-- 0005_qc.sql stay untouched and unused (ADR-033).
ALTER TABLE generations ADD COLUMN enhance_check_json TEXT;
