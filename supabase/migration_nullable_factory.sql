-- ============================================================================
-- MIGRATION: allow cross-factory accounts and incidents.
-- profiles.factory_id and incidents.factory_id were NOT NULL, forcing every
-- user/case to belong to exactly one factory. Some staff (admin/director) and
-- some cases span all factories or none. Make both nullable.
-- Safe to re-run.
-- ============================================================================

ALTER TABLE profiles  ALTER COLUMN factory_id DROP NOT NULL;
ALTER TABLE incidents ALTER COLUMN factory_id DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
