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
  machine_code TEXT NOT NULL,
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
  UNIQUE(factory_id, machine_code)
);

CREATE TABLE machine_qr_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  qr_code_url TEXT NOT NULL UNIQUE,
  generated_at TIMESTAMP DEFAULT NOW()
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
-- 4. INCIDENTS (Main Event Log)
-- ============================================================================

CREATE TABLE incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  incident_no TEXT NOT NULL,
  failure_code_id UUID NOT NULL REFERENCES failure_codes(id),

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
CREATE INDEX idx_incidents_machine_status ON incidents(machine_id, status);
CREATE INDEX idx_incidents_failure_code ON incidents(failure_code_id);
CREATE INDEX idx_incidents_created_at ON incidents(created_at DESC);
CREATE INDEX idx_incident_actions_incident_id ON incident_actions(incident_id);
CREATE INDEX idx_pm_records_status_date ON pm_records(status, scheduled_date);
CREATE INDEX idx_knowledge_base_keywords ON knowledge_base(keywords);
CREATE INDEX idx_maintenance_costs_machine_date ON maintenance_costs(machine_id, cost_date);

-- ============================================================================
-- RLS (ROW LEVEL SECURITY)
-- ============================================================================

ALTER TABLE factories ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm_records ENABLE ROW LEVEL SECURITY;

-- Users can see their own profile
CREATE POLICY "Users see own profile"
  ON profiles
  USING (auth.uid() = id);

-- ============================================================================
-- INITIAL DATA: Factories
-- ============================================================================

INSERT INTO factories (name, code, country) VALUES
('SJA', 'SJA', 'ID'),
('DIN', 'DIN', 'ID'),
('Olentia', 'OLT', 'ID')
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

ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;

-- ── Purchase Requests ────────────────────────────────────────
CREATE TYPE request_status AS ENUM (
  'draft','pending_dept_manager','pending_general_manager','pending_director','approved','rejected','returned'
);

CREATE TABLE purchase_requests (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title                TEXT NOT NULL,
  department_id        UUID REFERENCES departments(id),
  applicant_id         UUID REFERENCES profiles(id),
  purpose              TEXT,
  quantity             INT DEFAULT 1,
  estimated_cost       NUMERIC,
  status               request_status DEFAULT 'draft',
  current_approver_role TEXT,
  submitted_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ── Request Images ───────────────────────────────────────────
CREATE TABLE request_images (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id   UUID REFERENCES purchase_requests(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name    TEXT,
  sort_order   INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Request Attachments ──────────────────────────────────────
CREATE TABLE request_attachments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id   UUID REFERENCES purchase_requests(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name    TEXT,
  file_type    TEXT,
  file_size    INT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Request URLs ─────────────────────────────────────────────
CREATE TABLE request_urls (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id   UUID REFERENCES purchase_requests(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  title        TEXT,
  description  TEXT,
  thumbnail    TEXT,
  sort_order   INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Vendors ──────────────────────────────────────────────────
CREATE TABLE vendors (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id     UUID REFERENCES purchase_requests(id) ON DELETE CASCADE,
  vendor_name    TEXT NOT NULL,
  price          NUMERIC,
  delivery_days  INT,
  payment_terms  TEXT,
  warranty       TEXT,
  remarks        TEXT,
  sort_order     INT DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── AI Analyses ──────────────────────────────────────────────
CREATE TABLE ai_analyses (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id       UUID REFERENCES purchase_requests(id) ON DELETE CASCADE UNIQUE,
  summary          TEXT,
  business_purpose TEXT,
  advantages       TEXT,
  risks            TEXT,
  recommendation   TEXT,
  vendor_summary   TEXT,
  generated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Approvals ────────────────────────────────────────────────
CREATE TABLE approvals (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id  UUID REFERENCES purchase_requests(id) ON DELETE CASCADE,
  approver_id UUID REFERENCES profiles(id),
  role        TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('approve','reject','return')),
  comment     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Comments ─────────────────────────────────────────────────
CREATE TABLE comments (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID REFERENCES purchase_requests(id) ON DELETE CASCADE,
  author_id  UUID REFERENCES profiles(id),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── updated_at trigger ───────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON purchase_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE purchase_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_images       ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_attachments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_urls         ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors              ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_analyses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals            ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments             ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pr_select"    ON purchase_requests FOR SELECT USING (
  applicant_id = auth.uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('dept_manager','general_manager','director','purchasing'))
);
CREATE POLICY "pr_insert"    ON purchase_requests FOR INSERT WITH CHECK (applicant_id = auth.uid());
CREATE POLICY "pr_update"    ON purchase_requests FOR UPDATE USING (
  applicant_id = auth.uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('dept_manager','general_manager','director','purchasing'))
);

CREATE POLICY "img_select"   ON request_images        FOR SELECT USING (EXISTS (SELECT 1 FROM purchase_requests WHERE id = request_id AND (applicant_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('dept_manager','general_manager','director','purchasing')))));
CREATE POLICY "img_insert"   ON request_images        FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM purchase_requests WHERE id = request_id AND applicant_id = auth.uid()));
CREATE POLICY "att_select"   ON request_attachments   FOR SELECT USING (EXISTS (SELECT 1 FROM purchase_requests WHERE id = request_id AND (applicant_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('dept_manager','general_manager','director','purchasing')))));
CREATE POLICY "att_insert"   ON request_attachments   FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM purchase_requests WHERE id = request_id AND applicant_id = auth.uid()));
CREATE POLICY "url_select"   ON request_urls          FOR SELECT USING (EXISTS (SELECT 1 FROM purchase_requests WHERE id = request_id AND (applicant_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('dept_manager','general_manager','director','purchasing')))));
CREATE POLICY "url_insert"   ON request_urls          FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM purchase_requests WHERE id = request_id AND applicant_id = auth.uid()));
CREATE POLICY "ven_select"   ON vendors               FOR SELECT USING (EXISTS (SELECT 1 FROM purchase_requests WHERE id = request_id AND (applicant_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('dept_manager','general_manager','director','purchasing')))));
CREATE POLICY "ven_insert"   ON vendors               FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM purchase_requests WHERE id = request_id AND applicant_id = auth.uid()));
CREATE POLICY "ai_select"    ON ai_analyses           FOR SELECT USING (EXISTS (SELECT 1 FROM purchase_requests WHERE id = request_id AND (applicant_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('dept_manager','general_manager','director','purchasing')))));
CREATE POLICY "ai_insert"          ON ai_analyses         FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "approvals_select"   ON approvals           FOR SELECT USING (EXISTS (SELECT 1 FROM purchase_requests r WHERE r.id = request_id AND (r.applicant_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('dept_manager','general_manager','director','purchasing')))));
CREATE POLICY "approvals_insert"   ON approvals           FOR INSERT WITH CHECK (approver_id = auth.uid());

CREATE POLICY "comments_select"    ON comments            FOR SELECT USING (EXISTS (SELECT 1 FROM purchase_requests r WHERE r.id = request_id AND (r.applicant_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('dept_manager','general_manager','director','purchasing')))));
CREATE POLICY "comments_insert"    ON comments            FOR INSERT WITH CHECK (author_id = auth.uid());

-- ── Storage buckets (run in dashboard or via API) ─────────────
-- INSERT INTO storage.buckets (id, name, public) VALUES ('request-images', 'request-images', true);
-- INSERT INTO storage.buckets (id, name, public) VALUES ('request-attachments', 'request-attachments', false);

-- ── Material Price History ───────────────────────────────────
-- Run this in Supabase SQL Editor to add price tracking feature
CREATE TABLE IF NOT EXISTS material_price_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code_bb         TEXT NOT NULL,
  code_supplier   TEXT,
  supplier        TEXT,
  item_name       TEXT,
  tgl_po          DATE,
  tgl_tagihan     DATE,
  tgl_kirim       DATE,
  purchase_date   DATE,
  price_excl_ppn  NUMERIC,
  price_incl_ppn  NUMERIC,
  qty             NUMERIC,
  company         TEXT,
  sheet_name      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mph_code_bb       ON material_price_history(code_bb);
CREATE INDEX IF NOT EXISTS idx_mph_purchase_date ON material_price_history(purchase_date);
CREATE INDEX IF NOT EXISTS idx_mph_company       ON material_price_history(company);

-- RLS
ALTER TABLE material_price_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read price history"
  ON material_price_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Purchasing and director can insert price history"
  ON material_price_history FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('purchasing', 'director')
  ));
CREATE POLICY "Purchasing and director can delete price history"
  ON material_price_history FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('purchasing', 'director')
  ));
