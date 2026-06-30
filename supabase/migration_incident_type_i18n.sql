-- ============================================================================
-- MIGRATION: multilingual issue types (zh / en / id).
-- incident_types only had a single `label`, so admin-added types showed the
-- same text no matter the app language. Add per-language label columns; the
-- UI picks label_<locale> and falls back to whatever is filled, then `label`,
-- then `code`. Safe to re-run.
-- ============================================================================

ALTER TABLE incident_types ADD COLUMN IF NOT EXISTS label_zh TEXT;
ALTER TABLE incident_types ADD COLUMN IF NOT EXISTS label_en TEXT;
ALTER TABLE incident_types ADD COLUMN IF NOT EXISTS label_id TEXT;

-- Backfill the 7 built-in types with their existing translations so they keep
-- switching language after the UI moves from i18n keys to the DB columns.
UPDATE incident_types SET label_zh='🔧 機器故障',      label_en='🔧 Machine Failure',          label_id='🔧 Kerusakan Mesin'        WHERE code='machine';
UPDATE incident_types SET label_zh='🚿 水管/管線',     label_en='🚿 Pipe / Plumbing',          label_id='🚿 Pipa / Saluran'         WHERE code='pipe';
UPDATE incident_types SET label_zh='💡 電力/照明',     label_en='💡 Electrical / Lighting',    label_id='💡 Listrik / Pencahayaan'  WHERE code='electrical';
UPDATE incident_types SET label_zh='🏭 設施/基礎建設', label_en='🏭 Facility / Infrastructure', label_id='🏭 Fasilitas / Infrastruktur' WHERE code='facility';
UPDATE incident_types SET label_zh='⚠️ 安全問題',      label_en='⚠️ Safety Issue',             label_id='⚠️ Masalah Keselamatan'    WHERE code='safety';
UPDATE incident_types SET label_zh='🧹 衛生/清潔',     label_en='🧹 Cleanliness',              label_id='🧹 Kebersihan'             WHERE code='cleanliness';
UPDATE incident_types SET label_zh='📋 其他',          label_en='📋 Other',                    label_id='📋 Lainnya'                WHERE code='other';

-- Backfill remaining (admin-added) types: copy the existing single label into
-- every language column that is still empty, so nothing disappears.
UPDATE incident_types
SET label_zh = COALESCE(label_zh, label),
    label_en = COALESCE(label_en, label),
    label_id = COALESCE(label_id, label)
WHERE label_zh IS NULL OR label_en IS NULL OR label_id IS NULL;

NOTIFY pgrst, 'reload schema';
