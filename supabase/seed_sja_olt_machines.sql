-- ============================================================================
-- SEED: initial areas + machines for the SJA and Olentia (OLT) factories.
-- Mirrors seed_din_machines.sql. Self-contained and idempotent (safe to re-run).
-- For each factory it:
--   1. ensures work areas exist (Produksi / Packing / Gudang)
--   2. creates starter machines in the "Produksi" area
-- Column names match supabase/schema.sql:
--   machines(factory_id, area_id [NOT NULL], machine_code, machine_name,
--            brand, model, serial_number, status)
--   status: 'running' | 'repairing' | 'standby' | 'scrapped'
-- ============================================================================

-- 1. Ensure work areas exist for SJA + OLT
INSERT INTO areas (factory_id, name, code)
SELECT f.id, a.name, a.code
FROM factories f
CROSS JOIN (VALUES
  ('Produksi', 'PROD'),
  ('Packing',  'PACK'),
  ('Gudang',   'WH')
) AS a(name, code)
WHERE f.code IN ('SJA', 'OLT')
ON CONFLICT (factory_id, code) DO NOTHING;

-- 2A. SJA starter machines
INSERT INTO machines
  (factory_id, area_id, machine_code, machine_name, brand, model, serial_number, status)
SELECT
  f.id, ar.id, m.machine_code, m.machine_name, m.brand, m.model, m.serial_number, 'running'
FROM factories f
JOIN areas ar ON ar.factory_id = f.id AND ar.code = 'PROD'
CROSS JOIN (VALUES
  ('SJA-CMP-001', 'Air Compressor Unit',      'ATLAS COPCO', 'GA37',      'CMP-37-001'),
  ('SJA-CNV-001', 'Conveyor Belt Drive',      'SEW',         'R57DRN90',  'CNV-90-001'),
  ('SJA-INJ-001', 'Injection Molding Machine','HAITIAN',     'MA1600',    'INJ-1600-001'),
  ('SJA-BLR-001', 'Steam Boiler',             'MIURA',       'EX-100',    'BLR-100-001')
) AS m(machine_code, machine_name, brand, model, serial_number)
WHERE f.code = 'SJA'
  AND NOT EXISTS (
    SELECT 1 FROM machines x
    WHERE x.factory_id = f.id AND x.machine_code = m.machine_code
  );

-- 2B. Olentia (OLT) starter machines
INSERT INTO machines
  (factory_id, area_id, machine_code, machine_name, brand, model, serial_number, status)
SELECT
  f.id, ar.id, m.machine_code, m.machine_name, m.brand, m.model, m.serial_number, 'running'
FROM factories f
JOIN areas ar ON ar.factory_id = f.id AND ar.code = 'PROD'
CROSS JOIN (VALUES
  ('OLT-PMP-001', 'Process Water Pump',    'GRUNDFOS', 'CR45',      'PMP-45-001'),
  ('OLT-MIX-001', 'Industrial Mixer',      'SILVERSON','UHS-150',   'MIX-150-001'),
  ('OLT-FAN-001', 'Exhaust Fan Unit',      'EBM',      'RH56',      'FAN-56-001'),
  ('OLT-PLC-001', 'PLC Control Panel',     'OMRON',    'CP1H',      'PLC-1H-001')
) AS m(machine_code, machine_name, brand, model, serial_number)
WHERE f.code = 'OLT'
  AND NOT EXISTS (
    SELECT 1 FROM machines x
    WHERE x.factory_id = f.id AND x.machine_code = m.machine_code
  );

NOTIFY pgrst, 'reload schema';
