-- ============================================================================
-- FAMMS — ONE-SHOT SETUP / REPAIR SCRIPT
-- Paste the whole thing into Supabase → SQL Editor → Run.
-- Every statement is idempotent — safe to run as many times as needed.
--
-- Fixes in order:
--   1. Missing tables/columns (incident_updates, audit_logs, maintenance_logs…)
--   2. RLS off + GRANTs for the API roles (fixes "送出失敗" / data not loading)
--   3. factory_id nullable (cross-factory accounts & cases)
--   4. incident_types de-dupe + UNIQUE(code) (fixes triplicated issue types)
--   5. incident-photos storage bucket
--   6. Promote a0811332331@gmail.com to admin
--   7. Demo incidents across the full workflow
-- ============================================================================


-- ============================================================================
-- 1. MISSING TABLES & COLUMNS
-- ============================================================================
-- Older live DBs are missing many incidents columns (incident_type, status,
-- downtime_impact, etc.) — this was the real cause of "送出失敗". Ensure every
-- column the app uses exists.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS incident_type TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS machine_id UUID;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS facility_id UUID;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS incident_no TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS reporter_name TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS failure_code_id UUID;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS facility_issue_description TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'reported';
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS downtime_impact TEXT DEFAULT 'D';
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS reported_at TIMESTAMP DEFAULT NOW();
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS reported_by_id UUID;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS accepted_by_id UUID;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS root_cause TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS completion_type TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS observation_period INTEGER DEFAULT 0;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS observation_end_date DATE;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS closed_by_id UUID;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS remarks TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assigned_to TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assigned_dept TEXT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS due_date DATE;

-- These may have been created NOT NULL on old schemas — relax them so the
-- simplified report form (no failure_code / facility) can insert.
ALTER TABLE incidents ALTER COLUMN failure_code_id DROP NOT NULL;
ALTER TABLE incidents ALTER COLUMN incident_type   DROP NOT NULL;

ALTER TABLE machines ADD COLUMN IF NOT EXISTS asset_category TEXT DEFAULT 'machine';
ALTER TABLE pm_schedules ADD COLUMN IF NOT EXISTS interval_days INTEGER;

CREATE TABLE IF NOT EXISTS maintenance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  performed_by TEXT,
  notes TEXT,
  performed_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS incident_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

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
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);


-- ============================================================================
-- 3. CROSS-FACTORY: make factory_id nullable
-- ============================================================================
ALTER TABLE profiles  ALTER COLUMN factory_id DROP NOT NULL;
ALTER TABLE incidents ALTER COLUMN factory_id DROP NOT NULL;


-- ============================================================================
-- 4. INCIDENT TYPES: de-dupe + UNIQUE(code) + seed defaults
-- ============================================================================
DELETE FROM incident_types a USING incident_types b
WHERE a.code = b.code AND a.ctid > b.ctid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incident_types_code_key') THEN
    ALTER TABLE incident_types ADD CONSTRAINT incident_types_code_key UNIQUE (code);
  END IF;
END $$;

INSERT INTO incident_types (code, label, sort_order) VALUES
  ('machine','🔧 機器故障',1),('pipe','🚿 水管/管線',2),('electrical','💡 電力/照明',3),
  ('facility','🏭 設施/基礎建設',4),('safety','⚠️ 安全問題',5),('cleanliness','🧹 衛生/清潔',6),
  ('other','📋 其他',99)
ON CONFLICT (code) DO NOTHING;


-- ============================================================================
-- 2. RLS OFF + GRANTS (must run AFTER all tables exist)
-- ============================================================================
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;


-- ============================================================================
-- 5. STORAGE BUCKET for incident photos
-- ============================================================================
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


-- ============================================================================
-- 6. PROMOTE a0811332331@gmail.com TO ADMIN
-- ============================================================================
UPDATE profiles SET role = 'admin', is_active = true
WHERE id IN (SELECT id FROM auth.users WHERE email ILIKE 'a0811332331%');


-- ============================================================================
-- 7. DEMO INCIDENTS (full workflow). Remove later with:
--    DELETE FROM incidents WHERE incident_no LIKE 'FIT-DEMO-%';
-- ============================================================================
DO $$
DECLARE
  f_id UUID; m_id UUID;
  inc_analyzing UUID; inc_waiting UUID; inc_observation UUID;
BEGIN
  SELECT id INTO f_id FROM factories ORDER BY (code = 'DIN') DESC, name LIMIT 1;
  IF f_id IS NULL THEN RAISE NOTICE 'No factory — run schema.sql first.'; RETURN; END IF;
  SELECT id INTO m_id FROM machines WHERE factory_id = f_id ORDER BY machine_name LIMIT 1;

  DELETE FROM incident_updates WHERE incident_id IN (SELECT id FROM incidents WHERE incident_no LIKE 'FIT-DEMO-%');
  DELETE FROM incidents WHERE incident_no LIKE 'FIT-DEMO-%';

  INSERT INTO incidents (factory_id, machine_id, incident_type, incident_no, title, description, reporter_name, status, downtime_impact, reported_at)
  VALUES (f_id, m_id, 'machine', 'FIT-DEMO-001', '輸送帶馬達異音', '啟動時 motor 有異常聲響，懷疑 bearing 問題', '阿明', 'reported', 'B', NOW() - INTERVAL '2 hours');

  INSERT INTO incidents (factory_id, machine_id, incident_type, incident_no, title, description, reporter_name, status, downtime_impact, reported_at, accepted_at, assigned_to, assigned_dept, due_date)
  VALUES (f_id, m_id, 'electrical', 'FIT-DEMO-002', '配電箱 breaker 跳脫', 'Breaker 反覆跳脫，已先停機', '小華', 'accepted', 'A', NOW() - INTERVAL '5 hours', NOW() - INTERVAL '4 hours', '陳師傅', '機電課', CURRENT_DATE + 1);

  INSERT INTO incidents (factory_id, machine_id, incident_type, incident_no, title, description, reporter_name, status, downtime_impact, reported_at, accepted_at, assigned_to)
  VALUES (f_id, m_id, 'machine', 'FIT-DEMO-003', 'VFD 過熱跳機', '變頻器 over temperature，運轉約 30 分鐘後跳掉', '阿明', 'analyzing', 'B', NOW() - INTERVAL '1 day', NOW() - INTERVAL '22 hours', '陳師傅')
  RETURNING id INTO inc_analyzing;
  INSERT INTO incident_updates (incident_id, new_status, note, updated_by, created_at) VALUES
    (inc_analyzing, 'accepted', '已到現場，確認 VFD 散熱風扇積灰嚴重', '陳師傅', NOW() - INTERVAL '22 hours'),
    (inc_analyzing, 'analyzing', '清潔散熱片+風扇，量測運轉溫度中', '陳師傅', NOW() - INTERVAL '20 hours');

  INSERT INTO incidents (factory_id, machine_id, incident_type, incident_no, title, description, reporter_name, status, downtime_impact, reported_at, accepted_at, assigned_to)
  VALUES (f_id, m_id, 'machine', 'FIT-DEMO-004', 'Gearbox 漏油', '減速機油封老化漏油，需更換 oil seal', '小華', 'waiting_parts', 'C', NOW() - INTERVAL '2 days', NOW() - INTERVAL '47 hours', '林技師')
  RETURNING id INTO inc_waiting;
  INSERT INTO incident_updates (incident_id, new_status, note, updated_by, created_at) VALUES
    (inc_waiting, 'analyzing', '確認為 oil seal 老化', '林技師', NOW() - INTERVAL '46 hours'),
    (inc_waiting, 'waiting_parts', '已向倉庫請購 oil seal，預計 3 天到貨', '林技師', NOW() - INTERVAL '45 hours');

  INSERT INTO incidents (factory_id, machine_id, incident_type, incident_no, title, description, reporter_name, status, downtime_impact, reported_at, accepted_at, assigned_to)
  VALUES (f_id, m_id, 'electrical', 'FIT-DEMO-005', 'Sensor 訊號不穩', '近接 sensor 訊號間歇性消失', '阿明', 'observation', 'C', NOW() - INTERVAL '3 days', NOW() - INTERVAL '70 hours', '陳師傅')
  RETURNING id INTO inc_observation;
  INSERT INTO incident_updates (incident_id, new_status, note, updated_by, created_at) VALUES
    (inc_observation, 'repairing', '更換 proximity sensor 並重新校正', '陳師傅', NOW() - INTERVAL '60 hours'),
    (inc_observation, 'testing', '連續運轉測試 2 小時正常', '陳師傅', NOW() - INTERVAL '50 hours'),
    (inc_observation, 'observation', '進入現場觀察期，請產線回報是否再發生', '陳師傅', NOW() - INTERVAL '48 hours');

  INSERT INTO incidents (factory_id, machine_id, incident_type, incident_no, title, description, reporter_name, status, downtime_impact, reported_at, accepted_at, assigned_to, closed_at, completion_type, root_cause)
  VALUES (f_id, m_id, 'machine', 'FIT-DEMO-006', '皮帶斷裂更換', 'V-belt 斷裂，已更換新品', '小華', 'closed', 'B', NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days', '林技師', NOW() - INTERVAL '4 days', 'permanent_fix', 'V-belt 達使用壽命自然斷裂');
END $$;


-- ============================================================================
-- RELOAD API CACHE + VERIFY
-- ============================================================================
NOTIFY pgrst, 'reload schema';

SELECT '✅ tables' AS check, string_agg(table_name, ', ') AS result
FROM information_schema.tables
WHERE table_schema='public' AND table_name IN ('incident_updates','audit_logs','maintenance_logs','incident_types')
UNION ALL
SELECT '✅ admin', email FROM auth.users WHERE email ILIKE 'a0811332331%'
UNION ALL
SELECT '✅ demo cases', string_agg(incident_no, ', ' ORDER BY incident_no)
FROM incidents WHERE incident_no LIKE 'FIT-DEMO-%';
