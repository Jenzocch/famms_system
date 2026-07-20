-- ============================================================================
-- SECURITY PHASE 1 — Close the anon hole (run in Supabase SQL editor)
-- ============================================================================
--
-- WHY THIS IS URGENT
-- The anon key is PUBLIC: it ships in the browser bundle as
-- NEXT_PUBLIC_SUPABASE_ANON_KEY, so anyone who opens devtools can read it.
-- schema.sql / setup_all.sql never enable RLS (that happens later, in the
-- staged migration_rls_* chain), and two now-deleted "quick fix" scripts
-- (SETUP_RUN_ONCE.sql, fix_permissions_reset.sql) used to additionally GRANT
-- ALL on every public table to `anon` on top of that. Net effect on any DB
-- that ran either of them: anyone with that key can read / modify / delete
-- the ENTIRE database (all factories' incidents, machines, profiles,
-- telegram_chat_id, ...) WITHOUT logging in, by hitting the Supabase REST API
-- directly — completely bypassing the app, middleware and PERMISSIONS. Run
-- this migration regardless of whether you ever ran those scripts — it's the
-- fix either way.
--
-- WHAT THIS DOES
-- Revokes `anon`'s access to the application tables. Logged-in users use the
-- `authenticated` role, which is left untouched here, so in-app functionality
-- is UNCHANGED. Login and signup are unaffected:
--   - login uses the auth schema only (signInWithPassword), not public tables;
--   - profile creation runs through the handle_new_user() SECURITY DEFINER
--     trigger, which ignores these grants.
--
-- WHAT THIS DOES *NOT* DO
-- It does not yet isolate one factory's data from another for logged-in users
-- (authenticated is still broad). That is Phase 2 — per-factory RLS — which is
-- a breaking change and needs its own rollout. Phase 1 is the low-risk,
-- high-impact step: it stops unauthenticated access entirely.
--
-- TEST BEFORE PROD: run on a staging project first, then verify you can still
-- log in, report an incident, assign, run PM, and manage machines. Then run on
-- production. Safe to run more than once.

-- 1) Revoke anon's privileges on all existing objects in the public schema.
REVOKE ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- 2) Stop future tables/sequences/functions from auto-granting to anon
--    (SETUP_RUN_ONCE.sql had set ALTER DEFAULT PRIVILEGES ... TO anon).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;

-- Note: USAGE on schema public is intentionally left in place — revoking the
-- table-level grants above is what actually blocks data access. authenticated
-- and service_role keep their grants and are unaffected.

-- 3) Sanity check — should return NO rows for grantee 'anon' after this runs:
--    SELECT table_name, privilege_type
--    FROM information_schema.role_table_grants
--    WHERE grantee = 'anon' AND table_schema = 'public';
