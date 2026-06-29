-- ============================================================================
-- FAMMS Storage Setup
-- Run in Supabase SQL editor (or create buckets via dashboard).
-- Buckets:
--   incident-photos : public  — before/during/after photos, knowledge base photos
--   attachments     : private — PDFs, manuals, documents
-- ============================================================================

-- Create buckets (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('incident-photos', 'incident-photos', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('attachments', 'attachments', false)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Policies for incident-photos (public read, authenticated write/manage)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "incident_photos_public_read" ON storage.objects;
CREATE POLICY "incident_photos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'incident-photos');

DROP POLICY IF EXISTS "incident_photos_auth_insert" ON storage.objects;
CREATE POLICY "incident_photos_auth_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'incident-photos' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "incident_photos_auth_update" ON storage.objects;
CREATE POLICY "incident_photos_auth_update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'incident-photos' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "incident_photos_auth_delete" ON storage.objects;
CREATE POLICY "incident_photos_auth_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'incident-photos' AND auth.role() = 'authenticated');

-- ----------------------------------------------------------------------------
-- Policies for attachments (private — authenticated users only)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "attachments_auth_read" ON storage.objects;
CREATE POLICY "attachments_auth_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'attachments' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "attachments_auth_insert" ON storage.objects;
CREATE POLICY "attachments_auth_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'attachments' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "attachments_auth_delete" ON storage.objects;
CREATE POLICY "attachments_auth_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'attachments' AND auth.role() = 'authenticated');
