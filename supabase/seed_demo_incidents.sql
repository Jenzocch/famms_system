-- ============================================================================
-- DEMO: sample incidents across the full workflow so you can click through the
-- board and try each step. Safe to re-run (it deletes its own FIT-DEMO-* rows
-- first). Anchors everything to the first factory found (e.g. DIN).
-- ============================================================================

DO $$
DECLARE
  f_id UUID;
  m_id UUID;
  inc_analyzing UUID;
  inc_waiting   UUID;
  inc_observation UUID;
BEGIN
  -- Pick a factory (prefer DIN, else the first one)
  SELECT id INTO f_id FROM factories ORDER BY (code = 'DIN') DESC, name LIMIT 1;
  IF f_id IS NULL THEN
    RAISE NOTICE 'No factory found — run schema.sql first.';
    RETURN;
  END IF;

  -- Optionally attach a machine from that factory (may be null)
  SELECT id INTO m_id FROM machines WHERE factory_id = f_id ORDER BY machine_name LIMIT 1;

  -- Clean previous demo rows (and their timeline)
  DELETE FROM incident_updates WHERE incident_id IN (
    SELECT id FROM incidents WHERE incident_no LIKE 'FIT-DEMO-%'
  );
  DELETE FROM incidents WHERE incident_no LIKE 'FIT-DEMO-%';

  -- 1) 新回報 (reported) — urgent, nobody has picked it up yet
  INSERT INTO incidents (factory_id, machine_id, incident_type, incident_no, title, description, reporter_name, status, downtime_impact, reported_at)
  VALUES (f_id, m_id, 'machine', 'FIT-DEMO-001', '輸送帶馬達異音', '啟動時 motor 有異常聲響，懷疑 bearing 問題', '阿明', 'reported', 'B', NOW() - INTERVAL '2 hours');

  -- 2) 已接收 (accepted) — assigned
  INSERT INTO incidents (factory_id, machine_id, incident_type, incident_no, title, description, reporter_name, status, downtime_impact, reported_at, accepted_at, assigned_to, assigned_dept, due_date)
  VALUES (f_id, m_id, 'electrical', 'FIT-DEMO-002', '配電箱 breaker 跳脫', 'Breaker 反覆跳脫，已先停機', '小華', 'accepted', 'A', NOW() - INTERVAL '5 hours', NOW() - INTERVAL '4 hours', '陳師傅', '機電課', CURRENT_DATE + 1);

  -- 3) 處理中 (analyzing) — has a couple of timeline updates
  INSERT INTO incidents (factory_id, machine_id, incident_type, incident_no, title, description, reporter_name, status, downtime_impact, reported_at, accepted_at, assigned_to)
  VALUES (f_id, m_id, 'machine', 'FIT-DEMO-003', 'VFD 過熱跳機', '變頻器 over temperature，運轉約 30 分鐘後跳掉', '阿明', 'analyzing', 'B', NOW() - INTERVAL '1 day', NOW() - INTERVAL '22 hours', '陳師傅')
  RETURNING id INTO inc_analyzing;

  INSERT INTO incident_updates (incident_id, new_status, note, updated_by, created_at) VALUES
    (inc_analyzing, 'accepted', '已到現場，確認 VFD 散熱風扇積灰嚴重', '陳師傅', NOW() - INTERVAL '22 hours'),
    (inc_analyzing, 'analyzing', '清潔散熱片+風扇，量測運轉溫度中，持續觀察', '陳師傅', NOW() - INTERVAL '20 hours');

  -- 4) 等待料件 (waiting_parts)
  INSERT INTO incidents (factory_id, machine_id, incident_type, incident_no, title, description, reporter_name, status, downtime_impact, reported_at, accepted_at, assigned_to)
  VALUES (f_id, m_id, 'machine', 'FIT-DEMO-004', 'Gearbox 漏油', '減速機油封老化漏油，需更換 oil seal', '小華', 'waiting_parts', 'C', NOW() - INTERVAL '2 days', NOW() - INTERVAL '47 hours', '林技師')
  RETURNING id INTO inc_waiting;

  INSERT INTO incident_updates (incident_id, new_status, note, updated_by, created_at) VALUES
    (inc_waiting, 'analyzing', '確認為 oil seal 老化', '林技師', NOW() - INTERVAL '46 hours'),
    (inc_waiting, 'waiting_parts', '已向倉庫請購 oil seal，預計 3 天到貨', '林技師', NOW() - INTERVAL '45 hours');

  -- 5) 待現場確認 (observation) — fix applied, watching for recurrence
  INSERT INTO incidents (factory_id, machine_id, incident_type, incident_no, title, description, reporter_name, status, downtime_impact, reported_at, accepted_at, assigned_to)
  VALUES (f_id, m_id, 'electrical', 'FIT-DEMO-005', 'Sensor 訊號不穩', '近接 sensor 訊號間歇性消失', '阿明', 'observation', 'C', NOW() - INTERVAL '3 days', NOW() - INTERVAL '70 hours', '陳師傅')
  RETURNING id INTO inc_observation;

  INSERT INTO incident_updates (incident_id, new_status, note, updated_by, created_at) VALUES
    (inc_observation, 'repairing', '更換 proximity sensor 並重新校正', '陳師傅', NOW() - INTERVAL '60 hours'),
    (inc_observation, 'testing', '連續運轉測試 2 小時正常', '陳師傅', NOW() - INTERVAL '50 hours'),
    (inc_observation, 'observation', '進入現場觀察期，請產線回報是否再發生', '陳師傅', NOW() - INTERVAL '48 hours');

  -- 6) 已結案 (closed)
  INSERT INTO incidents (factory_id, machine_id, incident_type, incident_no, title, description, reporter_name, status, downtime_impact, reported_at, accepted_at, assigned_to, closed_at, completion_type, root_cause)
  VALUES (f_id, m_id, 'machine', 'FIT-DEMO-006', '皮帶斷裂更換', 'V-belt 斷裂，已更換新品', '小華', 'closed', 'B', NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days', '林技師', NOW() - INTERVAL '4 days', 'permanent_fix', 'V-belt 達使用壽命自然斷裂');

  RAISE NOTICE 'Demo incidents created for factory %', f_id;
END $$;

-- Verify
SELECT incident_no, status, title FROM incidents WHERE incident_no LIKE 'FIT-DEMO-%' ORDER BY incident_no;
