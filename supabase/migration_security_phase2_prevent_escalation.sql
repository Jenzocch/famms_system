-- ============================================================================
-- SECURITY PHASE 2 — prevent privilege escalation via the `profiles` table.
--
-- Context: RLS is currently DISABLED and the `authenticated` role has GRANT ALL,
-- so any logged-in user can write `profiles` directly from the browser client.
-- The worst consequence is self-escalation:
--     supabase.from('profiles').update({ role: 'admin' }).eq('id', myId)
-- …which would make any technician a full admin. This trigger closes that hole
-- without breaking the legitimate self-service edit on /profile (name + factory)
-- or the admin user-management API (which uses the service-role key).
--
-- Rules enforced on UPDATE of profiles:
--   • service-role / server calls (auth.uid() IS NULL)  -> allowed
--   • the caller is an admin                            -> allowed
--   • a non-admin may only update their OWN row         -> else blocked
--   • a non-admin may NOT change `role` or `is_active`  -> else blocked
--
-- Safe to re-run.
-- ============================================================================

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
  -- Service-role / trusted server code (admin API) has no end-user JWT.
  IF caller_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role INTO caller_role FROM profiles WHERE id = caller_id;

  -- Admins may change anything (role, active status, any user).
  IF caller_role = 'admin' THEN
    RETURN NEW;
  END IF;

  -- Non-admins may only touch their own profile row.
  IF NEW.id <> caller_id OR OLD.id <> caller_id THEN
    RAISE EXCEPTION 'Not allowed to modify another user''s profile';
  END IF;

  -- …and may never change their own role or active status.
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'Not allowed to change role or active status';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_privilege_escalation ON profiles;
CREATE TRIGGER trg_prevent_profile_privilege_escalation
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_profile_privilege_escalation();
