-- ============================================================================
-- SYNC_SCHEMA_LATEST — bring any FAMMS database fully up to date.
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS
--   Features kept "not saving" / "not showing" because the app referenced
--   columns/tables that only some of the individual migration_*.sql files add,
--   and it was easy to miss one. This single script consolidates EVERY
--   structural change the app needs. It is fully idempotent (IF NOT EXISTS /
--   DROP NOT NULL / guarded constraints) — safe to run as many times as you
--   like. Run it once in the Supabase SQL editor after pulling new app code and
--   every feature's columns will exist.
--
-- WHAT IT DOES NOT DO
--   * No seed/demo data (see seed_*.sql).
--   * No Row-Level-Security enable/policies — those are deliberately staged and
--     security-sensitive; keep using migration_rls_*.sql / migration_security_*
--     for that. This script only guarantees the schema the app reads/writes.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- INCIDENTS — columns added after the original schema
-- ---------------------------------------------------------------------------
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS title             TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS description       TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS reporter_name     TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assigned_to       TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assigned_dept     TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS due_date          DATE;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS location_note     TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assigned_user_ids UUID[] DEFAULT '{}';
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS accepted_at       TIMESTAMP;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS accepted_by_id    UUID REFERENCES profiles(id);
-- SLA escalation de-dup: when this incident last triggered a Telegram alert.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS last_sla_alert_at TIMESTAMP;
-- Idempotency key for offline/flaky-signal retries: the report form generates
-- this once per form instance, so resubmitting after an ambiguous timeout
-- (network drop right at submit) is recognized as the same report instead of
-- creating a duplicate incident. NULL for rows created before this existed —
-- UNIQUE allows any number of NULLs, so that's not a conflict.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS client_request_id UUID UNIQUE;
-- The assignee's own "I expect to finish by" ETA, reported from the progress
-- form. Deliberately separate from due_date: due_date is the supervisor-set
-- deadline the SLA measures against, and technicians can't (and shouldn't)
-- move it — this column is how they communicate a date instead.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS estimated_completion_date DATE;
-- How many photos came with the ORIGINAL report. The photos themselves live
-- only in storage (incident-photos/{id}/, no DB record), so without this the
-- board would need one storage.list per card just to show a 📷 indicator.
-- Written once at report creation; 0 for rows from before this column
-- existed (their photos still show on the detail page as always).
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS photo_count INT NOT NULL DEFAULT 0;

-- Which factory an RCA record was filed for. Without this, the mandatory-RCA
-- close gate (checkRCARequirement in src/lib/rca.ts) could not tell "an RCA
-- exists for this failure_code" apart from "an RCA exists for this failure_code
-- AT THIS FACTORY" — so one factory filing an RCA silently satisfied the gate
-- for every OTHER factory hitting the same failure_code, even though they
-- never investigated their own root cause. NULL only for rows created before
-- this fix (can't be safely backfilled without the incident that triggered
-- them); the app's own satisfied-check now scopes by factory_id, so those
-- legacy rows just won't match any factory going forward.
ALTER TABLE rca_records ADD COLUMN IF NOT EXISTS factory_id UUID REFERENCES factories(id);

-- ---------------------------------------------------------------------------
-- STORAGE — lock down the public incident-photos bucket
-- ---------------------------------------------------------------------------
-- Previously enforced ONLY client-side — any authenticated user could call
-- the Storage REST API directly and upload an arbitrarily large or
-- arbitrarily-typed file into this PUBLIC, publicly-readable bucket. Matches
-- src/lib/constants.ts's ACCEPTED_IMAGE_TYPES / MAX_FILE_SIZE_MB. No-op if
-- the bucket doesn't exist yet (storage_setup.sql creates it).
UPDATE storage.buckets
SET file_size_limit = 10485760, -- 10 MB
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'incident-photos';

-- ---------------------------------------------------------------------------
-- INCIDENTS — machine must belong to the incident's own factory
-- ---------------------------------------------------------------------------
-- RLS's incidents_ins/upd policies only check factory_id is one you can
-- access — nothing enforced that machine_id actually BELONGS to that
-- factory_id. Every app write path (report form, edit form, Telegram /lapor)
-- happened to only ever offer factory-matched machines through their own UI,
-- but nothing stopped a direct API/devtools call from pointing factory_id at
-- one factory and machine_id at another factory's machine — polluting that
-- machine's fault history, health score, and KPIs with fabricated incidents.
-- One trigger closes the gap for every write path at once, present and
-- future, instead of patching each call site individually.
CREATE OR REPLACE FUNCTION enforce_incident_machine_factory()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.machine_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM machines WHERE id = NEW.machine_id AND factory_id = NEW.factory_id
    ) THEN
      RAISE EXCEPTION 'machine_id % does not belong to factory_id %', NEW.machine_id, NEW.factory_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS incidents_machine_factory_guard ON incidents;
CREATE TRIGGER incidents_machine_factory_guard
  BEFORE INSERT OR UPDATE OF machine_id, factory_id ON incidents
  FOR EACH ROW EXECUTE FUNCTION enforce_incident_machine_factory();

-- Marks a login as a SHARED DEVICE account (e.g. one tablet logged in
-- permanently and handed between several technicians) rather than one
-- person's own login. The report form auto-fills "回報人" from whoever is
-- logged in — fine for a personal account, but on a shared account that
-- default would silently attribute every report to the tablet instead of
-- the actual technician. useReporterAccounts() checks this flag and leaves
-- the field blank (forcing an active pick) when true.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_shared_device BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- TELEGRAM — new-report drafts
-- ---------------------------------------------------------------------------
-- Holds the in-progress state of a /lapor conversation between the "describe
-- the problem" prompt and the urgency button tap — Telegram gives no other
-- way to carry state across two separate incoming updates on a serverless
-- webhook. One row per chat (a second /lapor overwrites, not stacks); rows
-- are deleted the moment the incident is actually created, so an abandoned
-- draft just sits harmlessly until overwritten by the next /lapor.
CREATE TABLE IF NOT EXISTS telegram_report_drafts (
  chat_id      BIGINT PRIMARY KEY,
  profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  description  TEXT,
  photo_file_id TEXT,
  created_at   TIMESTAMP DEFAULT NOW()
);
-- Cross-factory accounts (no single profiles.factory_id) have to pick which
-- factory a report belongs to — this holds that pick across the extra step.
-- NULL until chosen; single-factory accounts skip the picker and this gets
-- set to their one factory immediately.
ALTER TABLE telegram_report_drafts ADD COLUMN IF NOT EXISTS factory_id UUID REFERENCES factories(id);

-- Reference photo so a reporter can tell areas apart at a glance in the
-- report form (e.g. two areas both named "Line 2"). One photo per area is
-- enough for recognition — not a gallery, so no separate table.
ALTER TABLE areas ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Personal Telegram notifications never filter by factory (notifyAssignees
-- looks up by profile_id), but the NOT NULL factory_id blocked cross-factory
-- accounts (admins) from registering a chat_id at all. NULL = "not tied to
-- one factory"; the partial unique index replaces UNIQUE(factory_id,
-- profile_id) for those rows, which treats NULLs as distinct.
ALTER TABLE telegram_users ALTER COLUMN factory_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS telegram_users_profile_nullfactory_uniq
  ON telegram_users(profile_id) WHERE factory_id IS NULL;

-- Shared groups: factory_id NULL = "all factories" (e.g. one office Telegram
-- group that should get every factory's alerts, instead of adding the same
-- group 3 times under 3 factories). telegram_group_id is already globally
-- UNIQUE, so no extra index is needed for this — a group row still can't be
-- duplicated regardless of factory_id.
ALTER TABLE telegram_groups ALTER COLUMN factory_id DROP NOT NULL;

-- The report form treats machine + failure code as optional, and some cases
-- span all/none of the factories — relax the old NOT NULLs.
ALTER TABLE incidents ALTER COLUMN machine_id      DROP NOT NULL;
ALTER TABLE incidents ALTER COLUMN failure_code_id DROP NOT NULL;
ALTER TABLE incidents ALTER COLUMN factory_id      DROP NOT NULL;

-- Fast "assigned to me" filtering (assigned_user_ids @> {me}).
CREATE INDEX IF NOT EXISTS idx_incidents_assigned_user_ids
  ON incidents USING GIN (assigned_user_ids);

-- Backfill accepted_at for cases already past 'reported' (Response-Time KPI).
UPDATE incidents i
SET accepted_at = COALESCE(
  (SELECT MIN(a.performed_at) FROM incident_actions a WHERE a.incident_id = i.id),
  i.created_at
)
WHERE i.status <> 'reported' AND i.accepted_at IS NULL;

-- incident_no must be unique (race backstop). Renumber any existing dups first.
WITH dups AS (
  SELECT id, incident_no,
         ROW_NUMBER() OVER (PARTITION BY incident_no ORDER BY created_at) AS rn
  FROM incidents WHERE incident_no IS NOT NULL
)
UPDATE incidents i
SET incident_no = i.incident_no || '-dup' || d.rn
FROM dups d
WHERE i.id = d.id AND d.rn > 1;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incidents_incident_no_key') THEN
    ALTER TABLE incidents ADD CONSTRAINT incidents_incident_no_key UNIQUE (incident_no);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- PROFILES / MACHINES
-- ---------------------------------------------------------------------------
ALTER TABLE profiles ALTER COLUMN factory_id DROP NOT NULL;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS asset_category TEXT DEFAULT 'machine';

-- ---------------------------------------------------------------------------
-- PM SCHEDULES — custom cadence + responsible person(s)
-- ---------------------------------------------------------------------------
ALTER TABLE pm_schedules ADD COLUMN IF NOT EXISTS interval_days     INTEGER;
ALTER TABLE pm_schedules ADD COLUMN IF NOT EXISTS assigned_user_ids UUID[] DEFAULT '{}';
ALTER TABLE pm_schedules ADD COLUMN IF NOT EXISTS assigned_to       TEXT;
-- Per-item checklist tick-off stored on the completed record:
-- [{"item": "檢查潤滑", "done": true}, ...]
ALTER TABLE pm_records ADD COLUMN IF NOT EXISTS checklist_results JSONB;
CREATE INDEX IF NOT EXISTS idx_pm_schedules_assigned_user_ids
  ON pm_schedules USING GIN (assigned_user_ids);

-- ---------------------------------------------------------------------------
-- MAINTENANCE LOGS (ad-hoc maintenance shown on the PM calendar)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maintenance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  performed_by TEXT,
  notes TEXT,
  performed_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);
-- RLS state is intentionally NOT touched here — this script re-runs on every
-- `git pull`, and forcing RLS off would silently undo migration_rls_3's
-- staged enablement every time. Table starts RLS-off by Postgres default on
-- first creation; if you've run the staged RLS rollout, its state is left alone.
CREATE INDEX IF NOT EXISTS idx_maintenance_logs_machine       ON maintenance_logs(machine_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_logs_performed_at  ON maintenance_logs(performed_at DESC);

-- ---------------------------------------------------------------------------
-- INCIDENT UPDATES (progress timeline)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incident_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  new_status TEXT,
  note TEXT,
  updated_by TEXT,
  updated_by_id UUID REFERENCES profiles(id),
  photos TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_incident_updates_incident ON incident_updates(incident_id);

-- ---------------------------------------------------------------------------
-- INCIDENT TYPES (+ per-language labels)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incident_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE incident_types ADD COLUMN IF NOT EXISTS label_zh TEXT;
ALTER TABLE incident_types ADD COLUMN IF NOT EXISTS label_en TEXT;
ALTER TABLE incident_types ADD COLUMN IF NOT EXISTS label_id TEXT;
-- Copy the single label into any empty language column so nothing disappears.
UPDATE incident_types
SET label_zh = COALESCE(label_zh, label),
    label_en = COALESCE(label_en, label),
    label_id = COALESCE(label_id, label)
WHERE label_zh IS NULL OR label_en IS NULL OR label_id IS NULL;

-- ---------------------------------------------------------------------------
-- AUDIT LOGS (+ incident audit-trail view)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  user_name TEXT,
  action_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID NOT NULL,
  old_value JSONB,
  new_value JSONB,
  change_summary TEXT,
  timestamp TIMESTAMP DEFAULT NOW(),
  ip_address TEXT,
  factory_id UUID REFERENCES factories(id),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource  ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);

CREATE OR REPLACE VIEW incident_audit_trail AS
  SELECT al.id, al.user_id, al.user_name, al.action_type, al.change_summary,
         al.old_value, al.new_value, al.timestamp, al.resource_id AS incident_id
  FROM audit_logs al
  WHERE al.resource_type = 'incident';

-- ---------------------------------------------------------------------------
-- VENDORS (reusable contractor roster for assignment)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID REFERENCES factories(id),  -- NULL = available to every factory
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vendors_factory ON vendors(factory_id);

-- ---------------------------------------------------------------------------
-- MAINTENANCE COSTS — close-time cost capture (labor / parts per incident)
-- ---------------------------------------------------------------------------
-- Incidents may have no machine (facility issues), so machine_id can't stay
-- NOT NULL; costs link back to their incident for the monthly report.
ALTER TABLE maintenance_costs ALTER COLUMN machine_id DROP NOT NULL;
ALTER TABLE maintenance_costs ADD COLUMN IF NOT EXISTS incident_id UUID REFERENCES incidents(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_maintenance_costs_incident ON maintenance_costs(incident_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_costs_date ON maintenance_costs(cost_date DESC);

-- ---------------------------------------------------------------------------
-- PARTS REQUESTS — local read-only tracking of parts asked for via
-- "向倉庫叫料" (POST /api/gudang/request forwards to Gudang One and, on
-- success, inserts one row here so the incident page can show status without
-- FAMMS ever polling the warehouse). Gudang One writes status forward
-- (requested -> ordered -> received/rejected) via /api/external/parts-requests.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parts_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID REFERENCES factories(id) ON DELETE SET NULL,
  incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
  machine_id UUID REFERENCES machines(id) ON DELETE SET NULL,

  items JSONB NOT NULL, -- [{name, part_no, qty, unit}, ...] as sent to Gudang
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('low', 'normal', 'urgent')),
  note TEXT,

  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'ordered', 'received', 'rejected')),
  external_ref TEXT, -- Gudang One's own request id

  requested_by_id UUID REFERENCES profiles(id),
  requested_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_parts_requests_incident ON parts_requests(incident_id);
CREATE INDEX IF NOT EXISTS idx_parts_requests_status   ON parts_requests(status);

-- ---------------------------------------------------------------------------
-- Make PostgREST (the Supabase API) pick up all of the above immediately.
-- `anon` is deliberately excluded: the anon key ships in the browser bundle
-- (NEXT_PUBLIC_SUPABASE_ANON_KEY), so granting it table access defeats
-- migration_security_phase1_revoke_anon.sql every time this script re-runs.
-- The app only uses `anon` pre-login; all in-app reads/writes are via
-- `authenticated` (RLS-scoped) or the service-role admin client.
-- ---------------------------------------------------------------------------
GRANT ALL ON ALL TABLES    IN SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';

-- Sanity check: confirm the columns/tables that caused the "won't save / won't
-- show" bugs are now present.
SELECT 'incidents.assigned_user_ids'  AS object,
       to_regclass('public.incidents') IS NOT NULL
         AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name='incidents' AND column_name='assigned_user_ids') AS present
UNION ALL SELECT 'pm_schedules.assigned_user_ids',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='pm_schedules' AND column_name='assigned_user_ids')
UNION ALL SELECT 'pm_schedules.assigned_to',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='pm_schedules' AND column_name='assigned_to')
UNION ALL SELECT 'vendors table', to_regclass('public.vendors') IS NOT NULL
UNION ALL SELECT 'incidents.location_note',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='incidents' AND column_name='location_note')
UNION ALL SELECT 'parts_requests table', to_regclass('public.parts_requests') IS NOT NULL
UNION ALL SELECT 'areas.photo_url',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='areas' AND column_name='photo_url')
UNION ALL SELECT 'telegram_users.factory_id nullable',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='telegram_users' AND column_name='factory_id'
                 AND is_nullable='YES')
UNION ALL SELECT 'telegram_groups.factory_id nullable (shared groups)',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='telegram_groups' AND column_name='factory_id'
                 AND is_nullable='YES')
UNION ALL SELECT 'incidents.estimated_completion_date',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='incidents' AND column_name='estimated_completion_date')
UNION ALL SELECT 'telegram_report_drafts table', to_regclass('public.telegram_report_drafts') IS NOT NULL
UNION ALL SELECT 'incidents.photo_count',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='incidents' AND column_name='photo_count')
UNION ALL SELECT 'profiles.is_shared_device',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='profiles' AND column_name='is_shared_device')
UNION ALL SELECT 'telegram_report_drafts.factory_id',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='telegram_report_drafts' AND column_name='factory_id');
