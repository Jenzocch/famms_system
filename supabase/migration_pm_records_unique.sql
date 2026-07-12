-- ============================================================================
-- PM RECORDS UNIQUENESS — one row per (schedule, occurrence date)
-- ============================================================================
-- Two technicians completing the same projected task at the same moment both
-- passed the app's "does a row exist yet?" check and each inserted one —
-- duplicate rows that double-count PM compliance and can each spawn their own
-- "next occurrence". The check-then-insert pattern can't be made safe from
-- the app side; the database must enforce it.
--
-- Idempotent — safe to run repeatedly.
-- ============================================================================

-- 1. Merge any duplicates that already exist (keep the "most complete" row:
--    completed > skipped > pending, then the earliest-created of those).
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY pm_schedule_id, scheduled_date
           ORDER BY
             CASE status WHEN 'completed' THEN 0 WHEN 'skipped' THEN 1 ELSE 2 END,
             created_at
         ) AS rn
  FROM pm_records
)
DELETE FROM pm_records
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2. Enforce it going forward.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pm_records_schedule_date
  ON pm_records (pm_schedule_id, scheduled_date);

-- Verify
SELECT indexname FROM pg_indexes
WHERE tablename = 'pm_records' AND indexname = 'uq_pm_records_schedule_date';
