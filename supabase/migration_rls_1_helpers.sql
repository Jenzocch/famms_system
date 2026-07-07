-- ============================================================================
-- RLS PHASE 3 — Step 1 of 3: helper functions + tightened profile trigger.
--
-- These are INERT on their own (they don't enable RLS). They provide the
-- building blocks used by the policies in step 2, and extend the phase-2
-- privilege-escalation trigger to also block a non-admin from switching their
-- own factory (the tenant boundary — decided: only admin may assign factory).
--
-- All helpers are SECURITY DEFINER + STABLE so they read `profiles` WITHOUT
-- triggering RLS recursion (a policy on profiles must not itself be filtered by
-- a policy on profiles).
--
-- Visibility model (decided with the owner):
--   • admin / manager / director  -> cross-factory (see & act on ALL factories)
--   • technician / supervisor      -> their own factory only
--   • rows with factory_id IS NULL -> visible to everyone (global/shared)
--
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION app_role() RETURNS TEXT
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION app_factory() RETURNS UUID
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT factory_id FROM profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION app_is_admin() RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(app_role() = 'admin', false)
$$;

-- manager+admin — manages equipment master, PM schedules, settings
CREATE OR REPLACE FUNCTION app_is_manager_plus() RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(app_role() IN ('manager','admin'), false)
$$;

-- supervisor..admin — accepts / closes / deletes incidents
CREATE OR REPLACE FUNCTION app_is_supervisor_plus() RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(app_role() IN ('supervisor','manager','director','admin'), false)
$$;

-- roles allowed to see every factory
CREATE OR REPLACE FUNCTION app_cross_factory() RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(app_role() IN ('manager','director','admin'), false)
$$;

-- Can the current user access rows belonging to factory f?
CREATE OR REPLACE FUNCTION app_can_access(f UUID) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
     AND ( app_cross_factory()
        OR f IS NOT DISTINCT FROM app_factory()
        OR f IS NULL )
$$;

-- ----------------------------------------------------------------------------
-- Tighten the phase-2 profile trigger: non-admins also may not change factory_id
-- (factory is now the tenant boundary). Name change still allowed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_profile_privilege_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id   UUID := auth.uid();
  caller_role TEXT;
BEGIN
  IF caller_id IS NULL THEN
    RETURN NEW;                                  -- service-role / server
  END IF;

  SELECT role INTO caller_role FROM profiles WHERE id = caller_id;

  IF caller_role = 'admin' THEN
    RETURN NEW;                                  -- admin may change anything
  END IF;

  IF NEW.id <> caller_id OR OLD.id <> caller_id THEN
    RAISE EXCEPTION 'Not allowed to modify another user''s profile';
  END IF;

  IF NEW.role       IS DISTINCT FROM OLD.role
     OR NEW.is_active   IS DISTINCT FROM OLD.is_active
     OR NEW.factory_id  IS DISTINCT FROM OLD.factory_id THEN
    RAISE EXCEPTION 'Not allowed to change role, active status, or factory';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_privilege_escalation ON profiles;
CREATE TRIGGER trg_prevent_profile_privilege_escalation
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_profile_privilege_escalation();
