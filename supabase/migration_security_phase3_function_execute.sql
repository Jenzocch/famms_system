-- ============================================================================
-- SECURITY PHASE 3 — Close the PUBLIC function-EXECUTE gap (run in Supabase SQL editor)
-- ============================================================================
--
-- WHY THIS IS NEEDED
-- migration_security_phase1_revoke_anon.sql revoked EXECUTE on every public
-- schema function FROM `anon` specifically. That is not the same as closing
-- the door: Postgres grants EXECUTE on every new function to the pseudo-role
-- `PUBLIC` by default, and EVERY role — including `anon` — is implicitly a
-- member of PUBLIC. `REVOKE ... FROM anon` alone does nothing if PUBLIC still
-- holds the grant, because `anon` still executes the function via its PUBLIC
-- membership. This closes that gap for every SECURITY DEFINER function in the
-- schema (they read `profiles` bypassing RLS by design — see each function's
-- own file — so being callable at all by an unauthenticated key matters).
--
-- WHAT THIS DOES
-- 1) Explicitly GRANTs EXECUTE on the RLS-policy helper functions (app_role,
--    app_is_admin, etc.) to `authenticated` FIRST — these are evaluated
--    in-policy for every table query a logged-in user makes, so they must
--    keep working. Without this step, revoking PUBLIC below would break
--    login-gated access entirely (every RLS-protected query would start
--    failing with "permission denied for function").
-- 2) Revokes EXECUTE from PUBLIC (and anon, redundantly-but-explicitly) on
--    every function this app defines in the public schema — both the RLS
--    helpers (still callable by `authenticated` per step 1) and the trigger
--    functions (handle_new_user, log_incident_change, etc.), which never
--    needed direct EXECUTE from any client role in the first place — Postgres
--    invokes trigger functions on the object owner's behalf regardless of the
--    triggering statement's role, so they keep firing normally.
-- 3) Resets default privileges so a function created later doesn't silently
--    reopen this via the same PUBLIC-default-grant behavior.
--
-- VERIFIED: grepped the whole app (src/) for `.rpc(` — zero calls. Nothing in
-- FAMMS calls any Postgres function directly via PostgREST's /rpc/ endpoint,
-- so no client role needs direct EXECUTE beyond what RLS policies require.
--
-- TEST BEFORE PROD: run on a staging project first, then verify you can still
-- log in, report an incident, view the board scoped to your factory, assign,
-- run PM, and close a case. Safe to run more than once.

-- 1) RLS-policy helper functions — `authenticated` must keep EXECUTE.
GRANT EXECUTE ON FUNCTION app_role()                 TO authenticated;
GRANT EXECUTE ON FUNCTION app_factory()               TO authenticated;
GRANT EXECUTE ON FUNCTION app_is_admin()              TO authenticated;
GRANT EXECUTE ON FUNCTION app_is_manager_plus()       TO authenticated;
GRANT EXECUTE ON FUNCTION app_is_supervisor_plus()    TO authenticated;
GRANT EXECUTE ON FUNCTION app_cross_factory()         TO authenticated;
GRANT EXECUTE ON FUNCTION app_can_access(UUID)        TO authenticated;
GRANT EXECUTE ON FUNCTION app_can_access_incident(UUID)    TO authenticated;
GRANT EXECUTE ON FUNCTION app_can_access_pm_schedule(UUID) TO authenticated;
-- Legacy phase-2 helpers (migration_rls_phase2.sql) — keep granted in case any
-- older policy still references them; harmless no-op if they're unused.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_role' AND pronamespace = 'public'::regnamespace) THEN
    GRANT EXECUTE ON FUNCTION public.user_role() TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_admin' AND pronamespace = 'public'::regnamespace) THEN
    GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_supervisor_up' AND pronamespace = 'public'::regnamespace) THEN
    GRANT EXECUTE ON FUNCTION public.is_supervisor_up() TO authenticated;
  END IF;
END $$;

-- 2) Revoke from PUBLIC (closes the anon-via-PUBLIC loophole) and from anon
--    explicitly, on every function this app defines. `authenticated` keeps
--    what step 1 just granted; trigger-only functions need no re-grant.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'app_role', 'app_factory', 'app_is_admin', 'app_is_manager_plus',
        'app_is_supervisor_plus', 'app_cross_factory', 'app_can_access',
        'app_can_access_incident', 'app_can_access_pm_schedule',
        'user_role', 'is_admin', 'is_supervisor_up',
        'prevent_profile_privilege_escalation', 'enforce_incident_field_roles',
        'enforce_incident_machine_factory', 'handle_new_user', 'log_incident_change',
        'rls_set'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
  END LOOP;
END $$;

-- 3) Future-proof: functions created later default to no PUBLIC execute.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;

-- 4) Sanity check — should return NO rows (no function in public schema is
--    still executable by anon or PUBLIC). grantee = 0 in the ACL means
--    PUBLIC — it has no row in pg_roles, so this uses a LEFT JOIN and
--    coalesces the label instead of an inner JOIN (which would silently
--    drop exactly the PUBLIC rows we're trying to catch):
--    SELECT p.proname, COALESCE(r.rolname, 'PUBLIC') AS grantee
--    FROM pg_proc p
--    JOIN pg_namespace n ON n.oid = p.pronamespace
--    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS a
--    LEFT JOIN pg_roles r ON r.oid = a.grantee
--    WHERE n.nspname = 'public' AND a.privilege_type = 'EXECUTE'
--      AND (a.grantee = 0 OR r.rolname = 'anon');
