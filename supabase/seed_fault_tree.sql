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
