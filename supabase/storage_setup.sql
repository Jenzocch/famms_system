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

-- File-type/size limits were previously enforced ONLY client-side (the
-- compression helpers) — any authenticated user could call the Storage REST
-- API directly and upload an arbitrarily large or arbitrarily-typed file
-- (including HTML with an embedded script, served back with an
-- attacker-chosen Content-Type) into this PUBLIC, publicly-READABLE bucket.
-- These match src/lib/constants.ts's ACCEPTED_IMAGE_TYPES/MAX_FILE_SIZE_MB.
UPDATE storage.buckets
SET file_size_limit = 10485760, -- 10 MB
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'incident-photos';

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
