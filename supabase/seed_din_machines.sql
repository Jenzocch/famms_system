-- ============================================================================
-- SEED: initial areas + machines for the DIN factory.
-- DIN had no machines, so reporting an incident / scheduling PM there failed.
-- This script is self-contained and idempotent (safe to re-run):
--   1. looks up the DIN factory by its code ('DIN')
--   2. ensures a few work areas exist for it
--   3. creates 4 starter machines in the "Produksi" area
-- Column names match supabase/schema.sql exactly:
--   machines(factory_id, area_id [NOT NULL], machine_code, machine_name,
--            brand, model, serial_number, owner_id, status)
--   status: 'running' | 'repairing' | 'standby' | 'scrapped'
-- ============================================================================

-- 1. Ensure DIN work areas exist (UNIQUE on (factory_id, code))
INSERT INTO areas (factory_id, name, code)
SELECT f.id, a.name, a.code
FROM factories f
CROSS JOIN (VALUES
  ('Produksi', 'PROD'),
  ('Packing',  'PACK'),
  ('Gudang',   'WH')
) AS a(name, code)
WHERE f.code = 'DIN'
ON CONFLICT (factory_id, code) DO NOTHING;

-- 2. Create starter machines in DIN / Produksi
INSERT INTO machines
  (factory_id, area_id, machine_code, machine_name, brand, model, serial_number, status)
SELECT
  f.id, ar.id, m.machine_code, m.machine_name, m.brand, m.model, m.serial_number, 'running'
FROM factories f
JOIN areas ar ON ar.factory_id = f.id AND ar.code = 'PROD'
CROSS JOIN (VALUES
  ('DIN-HMG-001', 'Horizontal Milling Gearbox', 'NAGEL',   'HMG 2500',  'HMG-2500-001'),
  ('DIN-VFD-001', 'VFD Motor Controller',       'SIEMENS', 'S7-1200',   'VFD-001-2024'),
  ('DIN-PMP-001', 'Hydraulic Pump Unit',        'REXROTH', 'A4VSO180',  'PMP-180-001'),
  ('DIN-FAN-001', 'Cooling Fan Motor',          'SIEMENS', '3PH-15kW',  'FAN-15KW-001')
) AS m(machine_code, machine_name, brand, model, serial_number)
WHERE f.code = 'DIN'
  AND NOT EXISTS (
    SELECT 1 FROM machines x
    WHERE x.factory_id = f.id AND x.machine_code = m.machine_code
  );

NOTIFY pgrst, 'reload schema';
