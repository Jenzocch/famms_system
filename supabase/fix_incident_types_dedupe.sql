-- ============================================================================
-- FIX: incident_types had duplicate rows because the seed used
-- `ON CONFLICT DO NOTHING` without a UNIQUE constraint on `code`, so every
-- re-run of schema.sql inserted another full copy of the 7 default types.
--
-- This script: (1) removes duplicates keeping the oldest row per code,
-- (2) adds the missing UNIQUE(code) constraint so it can never happen again.
-- Safe to run multiple times.
-- ============================================================================

-- 1) Delete duplicate rows, keeping the oldest (lowest ctid) per code
DELETE FROM incident_types a
USING incident_types b
WHERE a.code = b.code AND a.ctid > b.ctid;

-- 2) Add UNIQUE(code) if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'incident_types_code_key'
  ) THEN
    ALTER TABLE incident_types ADD CONSTRAINT incident_types_code_key UNIQUE (code);
  END IF;
END $$;

-- 3) Verify: should return 7 rows, one per code
SELECT code, label, sort_order FROM incident_types ORDER BY sort_order;
