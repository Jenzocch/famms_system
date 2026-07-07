-- ============================================================================
-- FIX: admin cannot create/edit users ("無法新增 teknisi").
--
-- The ad-hoc profile_prevent_factory_change trigger blocked factory_id
-- changes for any caller that isn't an authenticated admin — including the
-- SERVICE ROLE used by the admin API (/api/admin/users). service_role has
-- auth.uid() = NULL, so app_is_admin() is false and the trigger aborted the
-- profile upsert right after auth-user creation, rolling back the new account.
--
-- The protection it duplicated already exists in
-- trg_prevent_profile_privilege_escalation (migration_rls_1_helpers.sql),
-- which blocks non-admin role/is_active/factory_id changes AND correctly
-- bypasses when auth.uid() IS NULL (service role / server).
--
-- Fix: drop the redundant trigger. Safe to re-run.
-- ============================================================================

DROP TRIGGER IF EXISTS profile_prevent_factory_change_trigger ON profiles;
DROP FUNCTION IF EXISTS profile_prevent_factory_change();

-- Sanity: the remaining trigger still protects factory/role/is_active.
-- SELECT trigger_name FROM information_schema.triggers
-- WHERE event_object_table = 'profiles';
-- Expect: trg_prevent_profile_privilege_escalation (only).
