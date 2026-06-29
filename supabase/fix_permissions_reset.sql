-- ============================================================================
-- FIX: "送出失敗" on report + "refresh 資料會不見"
--
-- Symptom combo (INSERT fails AND SELECT returns nothing after refresh) is the
-- classic signature of either:
--   (a) RLS enabled on a table with no policy  -> all rows denied, or
--   (b) the authenticated/anon Postgres roles missing table GRANTs.
--
-- This script resets both for every table in the public schema, creates the
-- incident-photos storage bucket, and reloads the PostgREST schema cache.
-- It is idempotent — safe to run as many times as you like.
-- ============================================================================

-- 1) Disable RLS on every table in public (this app does authz in the app layer)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;

-- 2) Grant full privileges to the API roles on all current + future objects
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- 3) Create the incident-photos storage bucket (+ public read / auth write)
INSERT INTO storage.buckets (id, name, public)
VALUES ('incident-photos', 'incident-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "incident_photos_public_read" ON storage.objects;
CREATE POLICY "incident_photos_public_read"
  ON storage.objects FOR SELECT USING (bucket_id = 'incident-photos');

DROP POLICY IF EXISTS "incident_photos_auth_insert" ON storage.objects;
CREATE POLICY "incident_photos_auth_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'incident-photos' AND auth.role() = 'authenticated');

-- 4) Reload PostgREST so the changes take effect immediately
NOTIFY pgrst, 'reload schema';

-- 5) Quick sanity check: should now return rows, and rls should be false
SELECT tablename,
       rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('incidents', 'incident_types', 'profiles', 'factories')
ORDER BY tablename;
