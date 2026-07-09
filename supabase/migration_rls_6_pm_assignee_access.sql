-- ============================================================================
-- RLS PHASE 6 — patch: PM assignees can always see their scheduled task.
--
-- Mirror of migration_rls_4 (which did this for incidents), for PM. With
-- factory-scoped RLS, a technician assigned to a PM schedule in ANOTHER factory
-- (or whose own profile factory differs) could not see the task on their
-- calendar — PMFullCalendar filters to `assigned_user_ids.includes(me)`, but if
-- the row is never returned by RLS in the first place, the calendar is empty.
-- incidents got this exception in phase 4; pm_schedules was missed.
--
-- Fix: a PM schedule (and its pm_records) is visible when EITHER the user can
-- access the schedule's factory OR the user is listed in
-- pm_schedules.assigned_user_ids. WRITE stays manager+ only (unchanged) — this
-- patch only widens read/visibility for assignees. Safe to re-run.
--
-- Prereqs: migration_rls_1_helpers.sql, migration_rls_2_policies.sql,
--          pm_schedules.assigned_user_ids column (SYNC_SCHEMA_LATEST.sql).
-- ============================================================================

-- True if the current user may see this PM schedule (by factory OR assignment).
CREATE OR REPLACE FUNCTION app_can_access_pm_schedule(sched UUID) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM pm_schedules s
    WHERE s.id = sched
      AND ( app_can_access(s.factory_id) OR auth.uid() = ANY(s.assigned_user_ids) )
  )
$$;

-- === pm_schedules: factory access OR I'm an assignee (SELECT only) ===
-- Keep the manager+ write policy from migration_rls_2 intact; only replace SELECT.
DO $$ BEGIN
  IF to_regclass('public.pm_schedules') IS NOT NULL THEN
    DROP POLICY IF EXISTS pm_schedules_sel ON pm_schedules;
    CREATE POLICY pm_schedules_sel ON pm_schedules FOR SELECT
      USING (app_can_access(factory_id) OR auth.uid() = ANY(assigned_user_ids));
  END IF;
END $$;

-- === pm_records: visible through their (assignee-aware) parent schedule ===
-- Technicians legitimately complete PM records, so keep write open through the
-- same visibility rule (matches how incident children were handled in phase 4).
DO $$ BEGIN
  IF to_regclass('public.pm_records') IS NOT NULL THEN
    DROP POLICY IF EXISTS pm_records_sel ON pm_records;
    DROP POLICY IF EXISTS pm_records_ins ON pm_records;
    DROP POLICY IF EXISTS pm_records_upd ON pm_records;
    DROP POLICY IF EXISTS pm_records_del ON pm_records;
    CREATE POLICY pm_records_sel ON pm_records FOR SELECT
      USING (app_can_access_pm_schedule(pm_schedule_id));
    CREATE POLICY pm_records_ins ON pm_records FOR INSERT
      WITH CHECK (app_can_access_pm_schedule(pm_schedule_id));
    CREATE POLICY pm_records_upd ON pm_records FOR UPDATE
      USING (app_can_access_pm_schedule(pm_schedule_id))
      WITH CHECK (app_can_access_pm_schedule(pm_schedule_id));
    -- Deleting a PM record stays manager+ (schedule owners), not assignees.
    CREATE POLICY pm_records_del ON pm_records FOR DELETE
      USING (app_is_manager_plus() AND app_can_access_pm_schedule(pm_schedule_id));
  END IF;
END $$;
