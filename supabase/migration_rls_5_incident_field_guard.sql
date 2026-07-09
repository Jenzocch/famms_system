-- ============================================================================
-- RLS PHASE 5 — Enforce incident field-level roles at the DATABASE layer
--
-- WHY
-- incidents is written directly from the browser (AssignForm, ProgressUpdate)
-- using the authenticated anon client, not through an API route. The rules
--   • only supervisor+ may set/move due_date        (PERMISSIONS.editDueDate)
--   • only supervisor+ may edit title/description/
--     incident_type/downtime_impact                 (PERMISSIONS.editIncident)
--   • only supervisor+ may close/reopen an incident  (PERMISSIONS.closeIncident,
--     which is also where the mandatory-RCA gate lives)
-- currently exist ONLY as `if` checks inside React components. The incidents_upd
-- RLS policy checks factory + assignee access but NOT role, so any user who can
-- update the row (same-factory, or an assignee) can bypass the UI via devtools:
--     supabase.from('incidents').update({ due_date: '2099-01-01' })...
--     supabase.from('incidents').update({ status: 'closed' })...   -- skips RCA
--
-- This BEFORE UPDATE trigger enforces the same rules in Postgres, so the guard
-- holds no matter how the write arrives. It is surgical — it only blocks a
-- change to a protected column BY a non-supervisor. Everything technicians
-- legitimately do keeps working:
--   • ProgressUpdate sets status to analyzing/repairing/testing/observation
--     (never 'closed' — the close API route handles that) → allowed
--   • AssignForm technician saves never include due_date in the payload, so
--     NEW.due_date = OLD.due_date → not a change → allowed
--   • assignment columns (assigned_user_ids/assigned_to/assigned_dept) are
--     never checked here → still open to all roles
--
-- service_role (admin API, cron) has auth.uid() = NULL and is allowed through;
-- those paths do their own server-side role checks.
--
-- Prereq: migration_rls_1_helpers.sql (app_role). Safe to re-run.
-- TEST after applying, as a technician: progress-update a case through its
-- statuses (ok), try to move a due_date (blocked), try to close (blocked);
-- as a supervisor: all of the above work.
-- ============================================================================

CREATE OR REPLACE FUNCTION enforce_incident_field_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id   UUID := auth.uid();
  caller_role TEXT;
BEGIN
  -- service-role / server-side (no JWT) bypasses; those paths gate themselves.
  IF caller_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role INTO caller_role FROM profiles WHERE id = caller_id;

  -- supervisor..admin may change any of the protected fields.
  IF caller_role IN ('supervisor','manager','director','admin') THEN
    RETURN NEW;
  END IF;

  -- Below here the caller is a technician (or unknown role): block changes to
  -- protected columns, allow everything else (status to non-closed, assignment).

  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    RAISE EXCEPTION 'Only a supervisor can set the due date';
  END IF;

  -- Closing or reopening is supervisor+ (and the close API enforces the RCA
  -- gate). Any other status transition (accept, repair, test, observe) is fine.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND (NEW.status = 'closed' OR OLD.status = 'closed') THEN
    RAISE EXCEPTION 'Only a supervisor can close or reopen an incident';
  END IF;

  IF NEW.title          IS DISTINCT FROM OLD.title
     OR NEW.description    IS DISTINCT FROM OLD.description
     OR NEW.incident_type  IS DISTINCT FROM OLD.incident_type
     OR NEW.downtime_impact IS DISTINCT FROM OLD.downtime_impact THEN
    RAISE EXCEPTION 'Only a supervisor can edit incident details';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_incident_field_roles ON incidents;
CREATE TRIGGER trg_enforce_incident_field_roles
  BEFORE UPDATE ON incidents
  FOR EACH ROW
  EXECUTE FUNCTION enforce_incident_field_roles();
