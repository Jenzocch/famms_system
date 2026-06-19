-- ============================================================
-- PDP V1 — Database Schema
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Departments ─────────────────────────────────────────────
CREATE TABLE departments (
  id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO departments (name) VALUES
  ('Operations'), ('Finance'), ('Marketing'), ('IT'), ('HR'), ('Procurement'), ('Management');

-- ── Profiles (extends auth.users) ───────────────────────────
CREATE TYPE user_role AS ENUM ('applicant','dept_manager','general_manager','director','purchasing');

CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'applicant',
  department_id UUID REFERENCES departments(id),
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger to auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)), NEW.email, 'applicant')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

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
