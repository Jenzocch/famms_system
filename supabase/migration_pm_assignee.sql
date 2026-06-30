-- PM responsible person(s)
-- Lets a PM schedule be assigned to specific people (and/or "all technicians"),
-- mirroring how incidents are assigned. assigned_user_ids holds the linked
-- account ids used for "my maintenance" filtering; assigned_to is a denormalized
-- display summary (account names + any free-text people).

ALTER TABLE pm_schedules ADD COLUMN IF NOT EXISTS assigned_user_ids UUID[] DEFAULT '{}';
ALTER TABLE pm_schedules ADD COLUMN IF NOT EXISTS assigned_to TEXT;

-- GIN index so "assigned_user_ids @> {me}" filtering stays fast.
CREATE INDEX IF NOT EXISTS idx_pm_schedules_assigned_user_ids
  ON pm_schedules USING GIN (assigned_user_ids);
