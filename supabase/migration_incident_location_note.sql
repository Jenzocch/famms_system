-- ============================================================================
-- MIGRATION: free-text location note on incidents.
-- The report form's location picker (factory / area / machine) can't cover every
-- spot, so add an optional "other / type-it-yourself" location field. Safe to
-- re-run.
-- ============================================================================

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS location_note TEXT;

NOTIFY pgrst, 'reload schema';
