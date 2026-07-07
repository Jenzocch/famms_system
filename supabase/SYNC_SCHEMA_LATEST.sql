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
ALTER TABLE maintenance_logs DISABLE ROW LEVEL SECURITY;
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
ALTER TABLE incident_updates DISABLE ROW LEVEL SECURITY;
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
ALTER TABLE incident_types DISABLE ROW LEVEL SECURITY;
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
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;
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
ALTER TABLE vendors DISABLE ROW LEVEL SECURITY;
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
-- Make PostgREST (the Supabase API) pick up all of the above immediately.
-- ---------------------------------------------------------------------------
GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
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
               WHERE table_name='incidents' AND column_name='location_note');
