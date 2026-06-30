-- ============================================================================
-- MIGRATION: allow incidents without a specific machine.
-- incidents.machine_id was created NOT NULL in older databases, so reporting a
-- problem for a factory/area that has no machine selected (e.g. DIN before its
-- machines are added, or facility-type issues) fails with:
--   null value in column "machine_id" of relation "incidents"
--     violates not-null constraint
-- The report form treats the machine as optional, so make the column nullable.
-- Safe to re-run.
-- ============================================================================

ALTER TABLE incidents ALTER COLUMN machine_id DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
