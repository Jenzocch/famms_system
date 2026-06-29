-- ============================================================================
-- MIGRATION: create tables/columns added after the initial schema run.
-- Your live DB was built from an older schema.sql and is missing
-- incident_updates / audit_logs / maintenance_logs and several columns.
-- Everything here is idempotent (IF NOT EXISTS / OR REPLACE) — safe to re-run.
-- Run this BEFORE seed_demo_incidents.sql.
-- ============================================================================

-- ---- later-added columns on existing tables --------------------------------
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS reporter_name TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assigned_to TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assigned_dept TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE incidents ALTER COLUMN failure_code_id DROP NOT NULL;

ALTER TABLE machines ADD COLUMN IF NOT EXISTS asset_category TEXT DEFAULT 'machine';
ALTER TABLE pm_schedules ADD COLUMN IF NOT EXISTS interval_days INTEGER;

-- ---- maintenance_logs ------------------------------------------------------
CREATE TABLE IF NOT EXISTS maintenance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  performed_by TEXT,
  notes TEXT,
  performed_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE maintenance_logs DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_maintenance_logs_machine ON maintenance_logs(machine_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_logs_performed_at ON maintenance_logs(performed_at DESC);

-- ---- incident_updates (處理紀錄時間軸) -------------------------------------
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

-- ---- incident_types (報修類型) ---------------------------------------------
CREATE TABLE IF NOT EXISTS incident_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE incident_types DISABLE ROW LEVEL SECURITY;

-- ---- audit_logs (操作稽核) -------------------------------------------------
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
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);

CREATE OR REPLACE VIEW incident_audit_trail AS
  SELECT al.id, al.user_id, al.user_name, al.action_type, al.change_summary,
         al.old_value, al.new_value, al.timestamp, al.resource_id AS incident_id
  FROM audit_logs
  WHERE resource_type = 'incident';

-- ---- grant + reload so the API sees the new objects immediately ------------
GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';

-- Verify the previously-missing tables now exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('incident_updates', 'audit_logs', 'maintenance_logs', 'incident_types')
ORDER BY table_name;
