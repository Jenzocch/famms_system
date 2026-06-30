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
  updated_at TIMESTAMP DEFAULT NOW()
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
  updated_at TIMESTAMP DEFAULT NOW()
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

-- Partial unique indexes (machines and facilities only allow one null code per factory)
CREATE UNIQUE INDEX idx_machines_factory_machine_code ON machines(factory_id, machine_code) WHERE machine_code IS NOT NULL;
CREATE UNIQUE INDEX idx_facilities_factory_facility_code ON facilities(factory_id, facility_code) WHERE facility_code IS NOT NULL;

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

-- ============================================================================
-- ASSIGNMENT (派工指派) — who handles the case + due date
-- ============================================================================

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assigned_to TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assigned_dept TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS due_date DATE;

-- ============================================================================
-- PM MAINTENANCE ASSIGNMENT
-- ============================================================================

ALTER TABLE pm_schedules ADD COLUMN IF NOT EXISTS assigned_user_ids UUID[] DEFAULT '{}';
ALTER TABLE pm_schedules ADD COLUMN IF NOT EXISTS assigned_to TEXT;

CREATE INDEX IF NOT EXISTS idx_pm_schedules_assigned_user_ids
  ON pm_schedules USING GIN (assigned_user_ids);

-- ============================================================================
-- FAMMS Fault Tree Seed Data
-- Bahasa Indonesia + technical English terms
-- Run AFTER schema.sql (which inserts the 5 level-1 categories)
-- ============================================================================
-- Naming convention:
--   - Subcategory names: keep English technical terms (Bearing, Motor, VFD, PLC)
--   - Failure code names: Bahasa Indonesia (so technicians understand the symptom)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- LEVEL 2: Subcategories
-- ----------------------------------------------------------------------------

-- Mekanikal (MECH)
INSERT INTO failure_categories (code, name, level, parent_id, display_order)
SELECT v.code, v.name, 2, (SELECT id FROM failure_categories WHERE code = 'MECH'), v.ord
FROM (VALUES
  ('BEARING',    'Bearing',        1),
  ('CHAIN_BELT', 'Chain / Belt',   2),
  ('MOTOR',      'Motor / Drive',  3),
  ('GEARBOX',    'Gearbox',        4),
  ('STRUCTURE',  'Struktur / Frame', 5)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- Elektrikal (ELEC)
INSERT INTO failure_categories (code, name, level, parent_id, display_order)
SELECT v.code, v.name, 2, (SELECT id FROM failure_categories WHERE code = 'ELEC'), v.ord
FROM (VALUES
  ('VFD',        'VFD / Inverter',  1),
  ('PLC',        'PLC / Controller', 2),
  ('SENSOR',     'Sensor',          3),
  ('CONTACTOR',  'Contactor / Relay', 4),
  ('BREAKER',    'Breaker / Proteksi', 5),
  ('WIRING',     'Wiring / Kabel',  6)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- Utility (UTILITY)
INSERT INTO failure_categories (code, name, level, parent_id, display_order)
SELECT v.code, v.name, 2, (SELECT id FROM failure_categories WHERE code = 'UTILITY'), v.ord
FROM (VALUES
  ('AIR',     'Air Compressor', 1),
  ('STEAM',   'Steam / Boiler', 2),
  ('COOLING', 'Cooling Water',  3),
  ('EXHAUST', 'Exhaust / Ventilasi', 4)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- Proses (PROCESS)
INSERT INTO failure_categories (code, name, level, parent_id, display_order)
SELECT v.code, v.name, 2, (SELECT id FROM failure_categories WHERE code = 'PROCESS'), v.ord
FROM (VALUES
  ('PARAM',   'Parameter Proses', 1),
  ('QUALITY', 'Kualitas Produk',  2)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- Operasi (OPERATION)
INSERT INTO failure_categories (code, name, level, parent_id, display_order)
SELECT v.code, v.name, 2, (SELECT id FROM failure_categories WHERE code = 'OPERATION'), v.ord
FROM (VALUES
  ('OP_ERROR', 'Human Error', 1),
  ('NEGLECT',  'Kelalaian / Maintenance', 2)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- LEVEL 3: Failure Codes
-- ----------------------------------------------------------------------------

-- Helper pattern: insert codes linked to their subcategory

-- MECH > Bearing
INSERT INTO failure_codes (code, name, category_id, display_order)
SELECT v.code, v.name, (SELECT id FROM failure_categories WHERE code = 'BEARING'), v.ord
FROM (VALUES
  ('BEARING_001', 'Pelumasan Kurang (Lubrication)', 1),
  ('BEARING_002', 'Kemasukan Benda Asing',          2),
  ('BEARING_003', 'Aus / Worn',                      3),
  ('BEARING_004', 'Pemasangan Tidak Tepat',          4),
  ('BEARING_005', 'Seal Bocor / Rusak',              5),
  ('BEARING_006', 'Inner/Outer Race Tergores',       6)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- MECH > Chain / Belt
INSERT INTO failure_codes (code, name, category_id, display_order)
SELECT v.code, v.name, (SELECT id FROM failure_categories WHERE code = 'CHAIN_BELT'), v.ord
FROM (VALUES
  ('CHAIN_001', 'Chain Kendor',        1),
  ('CHAIN_002', 'Chain Aus',           2),
  ('CHAIN_003', 'Sprocket Aus',        3),
  ('CHAIN_004', 'Chain Putus',         4),
  ('BELT_001',  'Belt Kendor',         5),
  ('BELT_002',  'Belt Aus',            6),
  ('BELT_003',  'Belt Slip',           7),
  ('BELT_004',  'Belt Putus',          8)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- MECH > Motor / Drive
INSERT INTO failure_codes (code, name, category_id, display_order)
SELECT v.code, v.name, (SELECT id FROM failure_categories WHERE code = 'MOTOR'), v.ord
FROM (VALUES
  ('MOTOR_001', 'Bearing Motor Bermasalah', 1),
  ('MOTOR_002', 'Pendinginan Kurang (Overheat)', 2),
  ('MOTOR_003', 'Getaran Abnormal (Vibration)', 3),
  ('MOTOR_004', 'Lilitan Terbakar (Winding Burn)', 4),
  ('MOTOR_005', 'Rotor Macet',          5)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- MECH > Gearbox
INSERT INTO failure_codes (code, name, category_id, display_order)
SELECT v.code, v.name, (SELECT id FROM failure_categories WHERE code = 'GEARBOX'), v.ord
FROM (VALUES
  ('GEAR_001', 'Gear Aus',             1),
  ('GEAR_002', 'Gear Berisik (Noise)', 2),
  ('GEAR_003', 'Pelumasan Kurang',     3),
  ('GEAR_004', 'Gear Patah',           4),
  ('GEAR_005', 'Oil Seal Bocor',       5),
  ('GEAR_006', 'Gearbox Macet',        6)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- MECH > Structure
INSERT INTO failure_codes (code, name, category_id, display_order)
SELECT v.code, v.name, (SELECT id FROM failure_categories WHERE code = 'STRUCTURE'), v.ord
FROM (VALUES
  ('STRUCT_001', 'Baut Kendor',        1),
  ('STRUCT_002', 'Las Retak (Weld Crack)', 2),
  ('STRUCT_003', 'Frame Bengkok',      3),
  ('STRUCT_004', 'Cover/Guard Rusak',  4)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- ELEC > VFD
INSERT INTO failure_codes (code, name, category_id, display_order)
SELECT v.code, v.name, (SELECT id FROM failure_categories WHERE code = 'VFD'), v.ord
FROM (VALUES
  ('VFD_001', 'Overheat / Over Temperature', 1),
  ('VFD_002', 'Over Current',         2),
  ('VFD_003', 'Communication Error',  3),
  ('VFD_004', 'Setting Parameter Salah', 4),
  ('VFD_005', 'Kapasitor Aus',        5),
  ('VFD_006', 'Display Mati',         6)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- ELEC > PLC
INSERT INTO failure_codes (code, name, category_id, display_order)
SELECT v.code, v.name, (SELECT id FROM failure_categories WHERE code = 'PLC'), v.ord
FROM (VALUES
  ('PLC_001', 'I/O Module Bermasalah', 1),
  ('PLC_002', 'Battery Habis',        2),
  ('PLC_003', 'Program Error',        3),
  ('PLC_004', 'Communication Putus',  4),
  ('PLC_005', 'CPU Rusak',            5),
  ('PLC_006', 'Memory Penuh',         6)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- ELEC > Sensor
INSERT INTO failure_codes (code, name, category_id, display_order)
SELECT v.code, v.name, (SELECT id FROM failure_categories WHERE code = 'SENSOR'), v.ord
FROM (VALUES
  ('SENSOR_001', 'Sensor Mati / Failure', 1),
  ('SENSOR_002', 'Posisi Sensor Bergeser', 2),
  ('SENSOR_003', 'Sensor Kotor',       3),
  ('SENSOR_004', 'Kabel Sensor Putus', 4),
  ('SENSOR_005', 'Signal Drift',       5),
  ('SENSOR_006', 'Respon Lambat',      6)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- ELEC > Contactor / Relay
INSERT INTO failure_codes (code, name, category_id, display_order)
SELECT v.code, v.name, (SELECT id FROM failure_categories WHERE code = 'CONTACTOR'), v.ord
FROM (VALUES
  ('CONTACTOR_001', 'Kontak Lengket (Stuck)', 1),
  ('CONTACTOR_002', 'Kontak Terbakar',  2),
  ('CONTACTOR_003', 'Coil Rusak',       3),
  ('CONTACTOR_004', 'Kontak Bergetar',  4)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- ELEC > Breaker
INSERT INTO failure_codes (code, name, category_id, display_order)
SELECT v.code, v.name, (SELECT id FROM failure_categories WHERE code = 'BREAKER'), v.ord
FROM (VALUES
  ('BREAKER_001', 'Trip Berulang',     1),
  ('BREAKER_002', 'Tidak Bisa Reset',  2),
  ('BREAKER_003', 'ELCB Trip (Kebocoran)', 3)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- ELEC > Wiring
INSERT INTO failure_codes (code, name, category_id, display_order)
SELECT v.code, v.name, (SELECT id FROM failure_categories WHERE code = 'WIRING'), v.ord
FROM (VALUES
  ('WIRE_001', 'Koneksi Kendor',       1),
  ('WIRE_002', 'Kabel Terbakar',       2),
  ('WIRE_003', 'Isolasi Rusak',        3),
  ('WIRE_004', 'Terminal Korosi',      4)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- UTILITY > Air Compressor
INSERT INTO failure_codes (code, name, category_id, display_order)
SELECT v.code, v.name, (SELECT id FROM failure_categories WHERE code = 'AIR'), v.ord
FROM (VALUES
  ('AIR_001', 'Tekanan Abnormal',      1),
  ('AIR_002', 'Flow Kurang',           2),
  ('AIR_003', 'Air Dryer Bermasalah',  3),
  ('AIR_004', 'Filter Tersumbat',      4),
  ('AIR_005', 'Kebocoran (Leak)',      5),
  ('AIR_006', 'Cooling Water Tidak Mengalir', 6)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- UTILITY > Steam / Boiler
INSERT INTO failure_codes (code, name, category_id, display_order)
SELECT v.code, v.name, (SELECT id FROM failure_categories WHERE code = 'STEAM'), v.ord
FROM (VALUES
  ('STEAM_001', 'Tekanan Steam Rendah', 1),
  ('STEAM_002', 'Kondensat Menumpuk',   2),
  ('STEAM_003', 'Safety Valve Bermasalah', 3),
  ('STEAM_004', 'Pipa Steam Bocor',     4),
  ('STEAM_005', 'Steam Trap Rusak',     5)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- UTILITY > Cooling Water
INSERT INTO failure_codes (code, name, category_id, display_order)
SELECT v.code, v.name, (SELECT id FROM failure_categories WHERE code = 'COOLING'), v.ord
FROM (VALUES
  ('COOL_001', 'Suhu Air Abnormal',    1),
  ('COOL_002', 'Flow Kurang',          2),
  ('COOL_003', 'Cooling Tower Bermasalah', 3),
  ('COOL_004', 'Pipa Bocor',           4),
  ('COOL_005', 'Kualitas Air Buruk (Scaling)', 5)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- UTILITY > Exhaust
INSERT INTO failure_codes (code, name, category_id, display_order)
SELECT v.code, v.name, (SELECT id FROM failure_categories WHERE code = 'EXHAUST'), v.ord
FROM (VALUES
  ('EXHAUST_001', 'Tekanan Exhaust Abnormal', 1),
  ('EXHAUST_002', 'Filter Tersumbat',  2),
  ('EXHAUST_003', 'Bau / Kebocoran',   3)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- PROCESS > Parameter
INSERT INTO failure_codes (code, name, category_id, display_order)
SELECT v.code, v.name, (SELECT id FROM failure_categories WHERE code = 'PARAM'), v.ord
FROM (VALUES
  ('PARAM_001', 'Suhu Abnormal',       1),
  ('PARAM_002', 'Tekanan Abnormal',    2),
  ('PARAM_003', 'Flow Abnormal',       3),
  ('PARAM_004', 'pH Abnormal',         4),
  ('PARAM_005', 'Waktu / Timing Abnormal', 5)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- PROCESS > Quality
INSERT INTO failure_codes (code, name, category_id, display_order)
SELECT v.code, v.name, (SELECT id FROM failure_categories WHERE code = 'QUALITY'), v.ord
FROM (VALUES
  ('QUALITY_001', 'Cacat Visual',      1),
  ('QUALITY_002', 'Ukuran Tidak Sesuai', 2),
  ('QUALITY_003', 'Berat Tidak Sesuai', 3),
  ('QUALITY_004', 'Cacat Internal',    4)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- OPERATION > Human Error
INSERT INTO failure_codes (code, name, category_id, display_order)
SELECT v.code, v.name, (SELECT id FROM failure_categories WHERE code = 'OP_ERROR'), v.ord
FROM (VALUES
  ('OP_001', 'Urutan Operasi Salah',   1),
  ('OP_002', 'Setting Parameter Salah', 2),
  ('OP_003', 'Beban Berlebih (Overload)', 3),
  ('OP_004', 'Salah Start',            4)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;

-- OPERATION > Neglect
INSERT INTO failure_codes (code, name, category_id, display_order)
SELECT v.code, v.name, (SELECT id FROM failure_categories WHERE code = 'NEGLECT'), v.ord
FROM (VALUES
  ('NEG_001', 'Maintenance Terlewat',  1),
  ('NEG_002', 'Kurang Bersih',         2),
  ('NEG_003', 'Pelumasan Terlewat',    3),
  ('NEG_004', 'Parts Aus Tidak Diganti', 4)
) AS v(code, name, ord)
ON CONFLICT (code) DO NOTHING;
-- ============================================================================
-- FAMMS Demo Seed Data (areas + sample machines)
-- Run AFTER schema.sql + seed_fault_tree.sql
-- Lets you test the incident reporting flow with real machines.
-- ============================================================================

-- Areas (linked to factories by code)
INSERT INTO areas (factory_id, name, code, description)
SELECT f.id, a.name, a.code, a.description
FROM (VALUES
  ('SJA', 'Production',  'PROD', 'Area produksi'),
  ('SJA', 'Packing',     'PACK', 'Area packing'),
  ('SJA', 'Utility',     'UTIL', 'Boiler, compressor, chiller'),
  ('DIN', 'Production',  'PROD', 'Area produksi'),
  ('DIN', 'Warehouse',   'WH',   'Gudang'),
  ('OLT', 'Production',  'PROD', 'Area produksi')
) AS a(factory_code, name, code, description)
JOIN factories f ON f.code = a.factory_code
ON CONFLICT (factory_id, code) DO NOTHING;

-- Sample machines (dengan kode sederhana untuk testing)
INSERT INTO machines (factory_id, area_id, machine_code, machine_name, brand, model, status)
SELECT f.id, ar.id, m.machine_code, m.machine_name, m.brand, m.model, 'running'
FROM (VALUES
  -- DIN factory machines
  ('DIN', 'PROD', 'DIN-HMG-001', 'Homogenizer Line 1', 'GEA', 'Ariete 3160'),
  ('DIN', 'PROD', 'DIN-PMP-002', 'Transfer Pump 2',    'Grundfos', 'CRN 15'),
  ('DIN', 'PROD', 'DIN-MIX-001', 'Mesin Mixer 1',      'Merek A', 'Model A'),
  ('DIN', 'PROD', 'DIN-MTR-001', 'Motor 1',            'Merek B', 'Model B'),
  -- SJA factory machines
  ('SJA', 'PROD', 'SJA-MIX-001', 'Mixer Tank 1',        'Tetra Pak', 'R-200'),
  ('SJA', 'PROD', 'SJA-MIX-002', 'Mixer Tank 2',        'Merek C', 'Model C'),
  ('SJA', 'PACK', 'SJA-FIL-001', 'Filling Machine 1',   'Krones', 'Modulfill'),
  ('SJA', 'PACK', 'SJA-FIL-002', 'Filling Machine 2',   'Merek D', 'Model D'),
  ('SJA', 'UTIL', 'SJA-CMP-001', 'Air Compressor 1',    'Atlas Copco', 'GA 75'),
  ('SJA', 'UTIL', 'SJA-CMP-002', 'Air Compressor 2',    'Merek E', 'Model E'),
  -- Olentia factory machines
  ('OLT', 'PROD', 'OLT-CNV-001', 'Conveyor Line 1',     'Interroll', 'EC310'),
  ('OLT', 'PROD', 'OLT-CNV-002', 'Conveyor Line 2',     'Merek F', 'Model F'),
  ('OLT', 'PROD', 'OLT-PMP-001', 'Pompa 1',             'Merek G', 'Model G'),
  ('OLT', 'PROD', 'OLT-MTR-001', 'Motor 2',             'Merek H', 'Model H')
) AS m(factory_code, area_code, machine_code, machine_name, brand, model)
JOIN factories f ON f.code = m.factory_code
JOIN areas ar ON ar.factory_id = f.id AND ar.code = m.area_code
ON CONFLICT (factory_id, machine_code) DO NOTHING;

-- Sample facilities (廠區設施、基礎設施)
INSERT INTO facilities (factory_id, area_id, facility_code, facility_name, facility_type, description, status)
SELECT f.id, ar.id, fc.facility_code, fc.facility_name, fc.facility_type, fc.description, 'operational'
FROM (VALUES
  -- DIN factory facilities
  ('DIN', 'PROD', 'DIN-WTR-001', 'Water Supply Tank 1', 'water_system', 'Main water tank untuk produksi'),
  ('DIN', 'PROD', 'DIN-AIR-001', 'Air Compressor System', 'air_compressor', 'Central air supply untuk area produksi'),
  ('DIN', 'PROD', 'DIN-FLR-001', 'Production Floor', 'floor', 'Lantai area produksi'),
  ('DIN', 'PROD', 'DIN-LGT-001', 'LED Lighting Panel 1', 'lighting', 'Pencahayaan area produksi'),
  ('DIN', 'PROD', 'DIN-ELC-001', 'Main Electrical Panel', 'electrical', 'Main power distribution'),
  ('DIN', 'WH', 'DIN-FLR-002', 'Warehouse Floor', 'floor', 'Lantai gudang'),
  -- SJA factory facilities
  ('SJA', 'PROD', 'SJA-WTR-001', 'Water Supply - Production', 'water_system', 'Water untuk area produksi'),
  ('SJA', 'PROD', 'SJA-STM-001', 'Steam Generator', 'steam_system', 'Steam untuk proses'),
  ('SJA', 'PROD', 'SJA-FLR-001', 'Production Floor', 'floor', 'Lantai area produksi SJA'),
  ('SJA', 'PACK', 'SJA-AIR-001', 'Pneumatic System', 'air_compressor', 'Udara terkompresi untuk packing'),
  ('SJA', 'PACK', 'SJA-LGT-001', 'Packing Area Lights', 'lighting', 'Lampu area packing'),
  ('SJA', 'UTIL', 'SJA-CHI-001', 'Chiller System', 'cooling_system', 'Sistem pendingin utilitas'),
  -- Olentia factory facilities
  ('OLT', 'PROD', 'OLT-WTR-001', 'Water Distribution', 'water_system', 'Saluran air ke area produksi'),
  ('OLT', 'PROD', 'OLT-FLR-001', 'Conveyor Area Floor', 'floor', 'Lantai area konveyor'),
  ('OLT', 'PROD', 'OLT-LGT-001', 'Overhead Lighting', 'lighting', 'Lampu gantung area produksi')
) AS fc(factory_code, area_code, facility_code, facility_name, facility_type, description)
JOIN factories f ON f.code = fc.factory_code
JOIN areas ar ON ar.factory_id = f.id AND ar.code = fc.area_code
ON CONFLICT (factory_id, facility_code) DO NOTHING;
