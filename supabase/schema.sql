-- ============================================================
-- FAMMS — Factory Asset & Maintenance Management System
-- PostgreSQL Schema for Supabase
-- Version: 1.0
-- Created: 2026-06-23
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. AUTH & ORGANIZATION
-- ============================================================================

CREATE TABLE factories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  country TEXT DEFAULT 'ID',
  timezone TEXT DEFAULT 'Asia/Jakarta',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(factory_id, code)
);

-- Departments (for purchase request system)
CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(factory_id, code)
);

-- Profiles (extends auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  factory_id UUID NOT NULL REFERENCES factories(id),
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'technician',
  -- roles: 'technician' | 'supervisor' | 'manager' | 'director' | 'admin'
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Trigger to auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  default_factory_id UUID;
BEGIN
  -- Get first factory (SJA) as default
  SELECT id INTO default_factory_id FROM factories LIMIT 1;

  INSERT INTO public.profiles (id, factory_id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(default_factory_id, gen_random_uuid()),
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'technician'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================================
-- 2. MACHINES & EQUIPMENT MASTER DATA
-- ============================================================================

CREATE TABLE machines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  area_id UUID NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  machine_code TEXT,
  machine_name TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  serial_number TEXT,
  purchase_date DATE,
  install_date DATE,
  owner_id UUID REFERENCES profiles(id),
  maintenance_cycle INTEGER DEFAULT 30, -- days
  status TEXT DEFAULT 'running',
  -- status: 'running' | 'repairing' | 'standby' | 'scrapped'
  remarks TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(factory_id, machine_code) WHERE machine_code IS NOT NULL
);

CREATE TABLE machine_qr_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  qr_code_url TEXT NOT NULL UNIQUE,
  generated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 2B. FACILITIES & INFRASTRUCTURE (Non-Machine Assets)
-- ============================================================================

CREATE TABLE facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  area_id UUID REFERENCES areas(id) ON DELETE CASCADE,

  facility_code TEXT,
  facility_name TEXT NOT NULL,
  facility_type TEXT NOT NULL,
  -- 'water_system' | 'floor' | 'lighting' | 'air_compressor' | 'steam_system'
  -- | 'cooling_system' | 'electrical' | 'exhaust' | 'cleanliness' | 'safety' | 'other'

  description TEXT,
  owner_id UUID REFERENCES profiles(id),
  status TEXT DEFAULT 'operational',
  -- 'operational' | 'maintenance_needed' | 'critical' | 'out_of_service'

  remarks TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(factory_id, facility_code) WHERE facility_code IS NOT NULL
);

-- ============================================================================
-- 3. FAILURE CLASSIFICATION SYSTEM (Fault Tree)
-- ============================================================================

CREATE TABLE failure_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  level INTEGER NOT NULL, -- 1 = main, 2 = sub, 3 = leaf
  parent_id UUID REFERENCES failure_categories(id) ON DELETE CASCADE,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE failure_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category_id UUID NOT NULL REFERENCES failure_categories(id) ON DELETE RESTRICT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 3B. FACILITY ISSUE CATEGORIES (for non-machine incidents)
-- ============================================================================

CREATE TABLE facility_issue_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  facility_type TEXT NOT NULL,
  -- Linked to facilities.facility_type for relevance filtering
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 4. INCIDENTS (Main Event Log)
-- ============================================================================

CREATE TABLE incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,

  -- Report target: either machine OR facility, not both
  machine_id UUID REFERENCES machines(id) ON DELETE CASCADE,
  facility_id UUID REFERENCES facilities(id) ON DELETE CASCADE,
  incident_type TEXT NOT NULL,
  -- 'machine' | 'facility'

  incident_no TEXT NOT NULL,

  -- Simplified mobile-first report fields
  title TEXT,
  description TEXT,
  reporter_name TEXT,

  -- Machine incidents use failure_code; facility incidents can be null
  failure_code_id UUID REFERENCES failure_codes(id),

  -- Facility incidents use this for free-text description
  facility_issue_description TEXT,

  status TEXT DEFAULT 'reported',
  -- reported → accepted → analyzing → waiting_* → repairing → testing → observation → closed

  downtime_impact TEXT DEFAULT 'D',
  -- A = Factory Stop, B = Production Line Stop, C = Reduced Capacity, D = No Impact

  reported_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reported_by_id UUID REFERENCES profiles(id),

  -- Stamped the first time an incident advances past 'reported'.
  -- Used for accurate Response Time KPI (reported_at → accepted_at).
  accepted_at TIMESTAMP,
  accepted_by_id UUID REFERENCES profiles(id),

  root_cause TEXT,
  completion_type TEXT,
  -- 'temporary_fix' | 'permanent_fix' | null (when open)

  observation_period INTEGER DEFAULT 0, -- days (3, 7, 30)
  observation_end_date DATE,

  closed_at TIMESTAMP,
  closed_by_id UUID REFERENCES profiles(id),

  remarks TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Incident Relations (track repeat failures, same root cause, etc)
CREATE TABLE incident_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  related_incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  -- 'repeat_failure' | 'same_root_cause' | 'temporary_fix_followup' | 'new_failure'
  confirmed_by_id UUID REFERENCES profiles(id),
  confirmed_at TIMESTAMP,
  remarks TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(incident_id, related_incident_id, relation_type)
);

-- ============================================================================
-- 5. INCIDENT ACTIONS (Multi-step Repair)
-- ============================================================================

CREATE TABLE incident_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  action_sequence INTEGER NOT NULL,

  action_type TEXT NOT NULL,
  -- 'inspection' | 'temporary_fix' | 'root_cause_analysis' | 'part_replacement' | 'corrective_action' | 'preventive_action' | 'testing' | 'observation'

  description TEXT,
  performed_by_id UUID NOT NULL REFERENCES profiles(id),
  performed_at TIMESTAMP DEFAULT NOW(),

  duration_minutes INTEGER,

  parts_used TEXT, -- JSON: [{ part_code, qty, cost }, ...]
  labor_cost DECIMAL(12, 2),
  material_cost DECIMAL(12, 2),
  vendor_cost DECIMAL(12, 2),

  photos_before TEXT, -- JSON array of file paths
  photos_during TEXT,
  photos_after TEXT,

  status TEXT DEFAULT 'completed',
  -- 'pending' | 'in_progress' | 'completed' | 'blocked'

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Work Order Blocking Reason
CREATE TABLE work_order_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_action_id UUID NOT NULL REFERENCES incident_actions(id) ON DELETE CASCADE,

  block_reason TEXT NOT NULL,
  required_action TEXT NOT NULL,

  blocked_at TIMESTAMP DEFAULT NOW(),
  blocked_by_id UUID REFERENCES profiles(id),
  resolved_at TIMESTAMP,
  resolved_by_id UUID REFERENCES profiles(id),

  remarks TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 6. PREVENTIVE MAINTENANCE (PM)
-- ============================================================================

CREATE TABLE pm_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,

  pm_type TEXT NOT NULL,
  -- 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'half_yearly' | 'yearly'

  description TEXT,
  checklist TEXT, -- JSON array of checklist items

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE pm_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pm_schedule_id UUID NOT NULL REFERENCES pm_schedules(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,

  status TEXT DEFAULT 'pending',
  -- 'pending' | 'completed' | 'overdue' | 'skipped'

  completed_at TIMESTAMP,
  completed_by_id UUID REFERENCES profiles(id),

  delay_reason TEXT,
  findings TEXT,
  parts_replaced TEXT, -- JSON: [{ part_code, qty }, ...]
  cost DECIMAL(12, 2),

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 7. SPARE PARTS INTEGRATION
-- ============================================================================

CREATE TABLE spare_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,

  part_code TEXT NOT NULL,
  part_name TEXT NOT NULL,
  category TEXT,
  unit_price DECIMAL(12, 2),

  stock_qty INTEGER DEFAULT 0,
  reorder_level INTEGER DEFAULT 5,
  supplier TEXT,
  lead_time_days INTEGER,

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(factory_id, part_code)
);

CREATE TABLE spare_part_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES spare_parts(id) ON DELETE CASCADE,

  transaction_type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  incident_action_id UUID REFERENCES incident_actions(id) ON DELETE SET NULL,

  cost DECIMAL(12, 2),

  created_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES profiles(id),
  remarks TEXT
);

-- ============================================================================
-- 8. COMMENTS & AUDIT TRAIL
-- ============================================================================

CREATE TABLE incident_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,

  comment TEXT NOT NULL,
  created_by_id UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE approval_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_action_id UUID NOT NULL REFERENCES incident_actions(id) ON DELETE CASCADE,

  action TEXT NOT NULL, -- 'approved' | 'rejected' | 'returned'
  approved_by_id UUID NOT NULL REFERENCES profiles(id),
  approved_at TIMESTAMP DEFAULT NOW(),

  remarks TEXT
);

-- ============================================================================
-- 9. ROOT CAUSE ANALYSIS (RCA)
-- ============================================================================

CREATE TABLE rca_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  failure_code_id UUID NOT NULL REFERENCES failure_codes(id),

  root_cause TEXT NOT NULL,
  corrective_action TEXT NOT NULL,
  preventive_action TEXT NOT NULL,

  responsible_person_id UUID NOT NULL REFERENCES profiles(id),
  due_date DATE NOT NULL,

  status TEXT DEFAULT 'open',
  -- 'open' | 'in_progress' | 'completed' | 'closed'

  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 10. EQUIPMENT HEALTH SCORE
-- ============================================================================

CREATE TABLE equipment_health_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,

  score INTEGER NOT NULL, -- 0-100

  failure_count_90d INTEGER,
  downtime_hours_90d DECIMAL(10, 2),
  repeat_failure_count INTEGER,
  pm_overdue_count INTEGER,

  last_updated TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 11. ENGINEERING KNOWLEDGE BASE
-- ============================================================================

CREATE TABLE knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID REFERENCES incidents(id) ON DELETE SET NULL,

  problem TEXT NOT NULL,
  root_cause TEXT NOT NULL,
  repair_method TEXT NOT NULL,

  photos TEXT, -- JSON array of file paths
  parts_used TEXT, -- JSON array of part codes

  lessons_learned TEXT,
  keywords TEXT, -- for full-text search

  created_by_id UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 12. NOTIFICATIONS & TELEGRAM
-- ============================================================================

CREATE TABLE telegram_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  telegram_chat_id BIGINT NOT NULL UNIQUE,
  telegram_username TEXT,

  notification_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(factory_id, profile_id)
);

CREATE TABLE telegram_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  telegram_group_id BIGINT NOT NULL UNIQUE,

  notify_new_incident BOOLEAN DEFAULT true,
  notify_sla_alert BOOLEAN DEFAULT true,
  notify_blocking BOOLEAN DEFAULT true,
  notify_daily_summary BOOLEAN DEFAULT true,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  notification_type TEXT NOT NULL,
  recipient_type TEXT NOT NULL,
  recipient_id UUID NOT NULL,

  telegram_message_id BIGINT,
  status TEXT DEFAULT 'sent',

  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 13. MAINTENANCE COSTS
-- ============================================================================

CREATE TABLE maintenance_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,

  incident_action_id UUID REFERENCES incident_actions(id) ON DELETE SET NULL,

  cost_type TEXT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  currency TEXT DEFAULT 'IDR',

  cost_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 14. PROJECTS
-- ============================================================================

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,

  project_name TEXT NOT NULL,
  project_type TEXT,
  status TEXT DEFAULT 'planning',
  -- 'planning' | 'executing' | 'testing' | 'completed'

  start_date DATE,
  end_date DATE,
  budget DECIMAL(14, 2),

  manager_id UUID REFERENCES profiles(id),
  description TEXT,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_profiles_factory_id ON profiles(factory_id);
CREATE INDEX idx_machines_factory_area ON machines(factory_id, area_id);
CREATE INDEX idx_facilities_factory_area ON facilities(factory_id, area_id);
CREATE INDEX idx_incidents_machine_status ON incidents(machine_id, status);
CREATE INDEX idx_incidents_facility_status ON incidents(facility_id, status);
CREATE INDEX idx_incidents_type_status ON incidents(incident_type, status);
CREATE INDEX idx_incidents_failure_code ON incidents(failure_code_id);
CREATE INDEX idx_incidents_created_at ON incidents(created_at DESC);
CREATE INDEX idx_incident_actions_incident_id ON incident_actions(incident_id);
CREATE INDEX idx_pm_records_status_date ON pm_records(status, scheduled_date);
CREATE INDEX idx_knowledge_base_keywords ON knowledge_base(keywords);
CREATE INDEX idx_maintenance_costs_machine_date ON maintenance_costs(machine_id, cost_date);

-- ============================================================================
-- RLS (ROW LEVEL SECURITY) — DISABLED FOR INITIAL SETUP
-- ============================================================================
-- Uncomment after schema is created and seeded
-- ALTER TABLE factories ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE machines ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE incident_actions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE pm_schedules ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE pm_records ENABLE ROW LEVEL SECURITY;
--
-- CREATE POLICY "Users see own profile"
--   ON profiles
--   USING (auth.uid() = id);

-- ============================================================================
-- INITIAL DATA: Factories
-- ============================================================================

INSERT INTO factories (name, code, country) VALUES
('SJA', 'SJA', 'ID'),
('DIN', 'DIN', 'ID'),
('Olentia', 'OLT', 'ID')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- INITIAL DATA: Facility Issue Categories
-- ============================================================================

INSERT INTO facility_issue_categories (code, name, facility_type, display_order, is_active) VALUES
-- Water System
('WATER_LEAK', 'Kebocoran Air', 'water_system', 1, true),
('WATER_PRESSURE', 'Tekanan Air Rendah', 'water_system', 2, true),
('WATER_QUALITY', 'Kualitas Air Buruk', 'water_system', 3, true),

-- Floor & Structure
('FLOOR_CRACK', 'Lantai Retak/Rusak', 'floor', 1, true),
('FLOOR_SLIP', 'Lantai Licin/Hazard', 'floor', 2, true),

-- Lighting
('LIGHT_BROKEN', 'Lampu Mati/Rusak', 'lighting', 1, true),
('LIGHT_DIM', 'Pencahayaan Kurang', 'lighting', 2, true),

-- Air Compressor & Pneumatic
('COMPRESSOR_LOW_PRESSURE', 'Tekanan Udara Rendah', 'air_compressor', 1, true),
('COMPRESSOR_LEAK', 'Kebocoran Udara Terkompresi', 'air_compressor', 2, true),

-- Electrical & Safety
('ELECTRICAL_HAZARD', 'Hazard Listrik', 'electrical', 1, true),
('ELECTRICAL_FAULT', 'Fault Listrik', 'electrical', 2, true),

-- Cleanliness & Environment
('CLEANLINESS_ISSUE', 'Masalah Kebersihan', 'cleanliness', 1, true),
('PEST_INFESTATION', 'Serangan Hama', 'cleanliness', 2, true),

-- Safety
('SAFETY_HAZARD', 'Hazard Keselamatan', 'safety', 1, true),
('SAFETY_VIOLATION', 'Pelanggaran K3', 'safety', 2, true),

-- Other
('OTHER_FACILITY_ISSUE', 'Masalah Lainnya', 'other', 1, true)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- INITIAL DATA: Failure Categories & Codes (Fault Tree)
-- ============================================================================

-- Level 1: Main Categories
INSERT INTO failure_categories (code, name, level, display_order, is_active) VALUES
('MECH', 'Mekanikal', 1, 1, true),
('ELEC', 'Elektrikal', 1, 2, true),
('UTILITY', 'Utility', 1, 3, true),
('PROCESS', 'Proses', 1, 4, true),
('OPERATION', 'Operasi / Human Error', 1, 5, true)
ON CONFLICT (code) DO NOTHING;


-- ============================================================================
-- MAINTENANCE LOGS (簡化版 PM — 記錄每次保養)
-- ============================================================================

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

-- ============================================================================
-- MIGRATION: add simplified report fields + make codes optional
-- (safe to re-run on an existing database)
-- ============================================================================

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS reporter_name TEXT;

ALTER TABLE machines ALTER COLUMN machine_code DROP NOT NULL;
ALTER TABLE facilities ALTER COLUMN facility_code DROP NOT NULL;

-- failure_code_id no longer required for any incident
ALTER TABLE incidents ALTER COLUMN failure_code_id DROP NOT NULL;

-- ============================================================================
-- INCIDENT UPDATES (簡化版進度追蹤 — 每次狀態變更/處理紀錄)
-- ============================================================================

CREATE TABLE IF NOT EXISTS incident_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  new_status TEXT,
  note TEXT,
  updated_by TEXT,
  updated_by_id UUID REFERENCES profiles(id),
  photos TEXT,  -- JSON array of storage paths
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE incident_updates DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_incident_updates_incident ON incident_updates(incident_id);

-- Asset category for simplified item management (機器/項目分類)
ALTER TABLE machines ADD COLUMN IF NOT EXISTS asset_category TEXT DEFAULT 'machine';
-- 'machine' | 'item' | 'pipe' | 'electrical' | 'facility'
