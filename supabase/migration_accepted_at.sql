-- ============================================================================
-- Migration: add accepted_at / accepted_by_id to incidents
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor on databases created BEFORE the
-- accepted_at column was added to schema.sql.
--
-- Purpose: accurate Response Time KPI. Previously the dashboard used
-- created_at as a proxy for "when the incident was accepted". This adds a
-- dedicated timestamp stamped the first time an incident moves past
-- 'reported' (see src/app/api/incidents/[id]/actions/route.ts).
-- ============================================================================

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS accepted_at    TIMESTAMP,
  ADD COLUMN IF NOT EXISTS accepted_by_id UUID REFERENCES profiles(id);

-- Backfill: for incidents already past 'reported' that have no accepted_at,
-- use the earliest action's performed_at as the best available estimate,
-- falling back to created_at.
UPDATE incidents i
SET accepted_at = COALESCE(
  (SELECT MIN(a.performed_at) FROM incident_actions a WHERE a.incident_id = i.id),
  i.created_at
)
WHERE i.status <> 'reported'
  AND i.accepted_at IS NULL;
