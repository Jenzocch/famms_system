-- ============================================================================
-- RLS PHASE 3 — patch: assignees can always see/work their incident.
--
-- With factory-scoped RLS, a technician/QC assigned to an incident in ANOTHER
-- factory (or whose own profile factory differs) could no longer see the case
-- assigned to them. That breaks the whole "assign to a person" workflow — a
-- technician's board is supposed to show exactly the cases assigned to them.
--
-- Fix: access to an incident (and its child rows, and its machine) is granted
-- when EITHER the user can access the incident's factory OR the user is listed
-- in incidents.assigned_user_ids. Safe to re-run.
-- ============================================================================

-- True if the current user may access this incident (by factory OR assignment)
CREATE OR REPLACE FUNCTION app_can_access_incident(inc UUID) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM incidents i
    WHERE i.id = inc
      AND ( app_can_access(i.factory_id) OR auth.uid() = ANY(i.assigned_user_ids) )
  )
$$;

-- === incidents: factory access OR I'm an assignee ===
DO $$ BEGIN
  IF to_regclass('public.incidents') IS NOT NULL THEN
    DROP POLICY IF EXISTS incidents_sel ON incidents;
    DROP POLICY IF EXISTS incidents_upd ON incidents;
    CREATE POLICY incidents_sel ON incidents FOR SELECT
      USING (app_can_access(factory_id) OR auth.uid() = ANY(assigned_user_ids));
    CREATE POLICY incidents_upd ON incidents FOR UPDATE
      USING (app_can_access(factory_id) OR auth.uid() = ANY(assigned_user_ids))
      WITH CHECK (app_can_access(factory_id) OR auth.uid() = ANY(assigned_user_ids));
  END IF;
END $$;

-- === incident children scoped through the (assignee-aware) parent ===
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['incident_actions','incident_relations','incident_comments','incident_updates'] LOOP
    IF to_regclass('public.'||tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I_sel ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_wr  ON %I', tbl, tbl);
    EXECUTE format('CREATE POLICY %I_sel ON %I FOR SELECT USING (app_can_access_incident(%I.incident_id))', tbl, tbl, tbl);
    EXECUTE format('CREATE POLICY %I_wr ON %I FOR ALL USING (app_can_access_incident(%I.incident_id)) WITH CHECK (app_can_access_incident(%I.incident_id))', tbl, tbl, tbl, tbl);
  END LOOP;
END $$;

-- === work_order_blocks: via its action's incident ===
DO $$ BEGIN
  IF to_regclass('public.work_order_blocks') IS NOT NULL THEN
    DROP POLICY IF EXISTS work_order_blocks_sel ON work_order_blocks;
    DROP POLICY IF EXISTS work_order_blocks_wr  ON work_order_blocks;
    CREATE POLICY work_order_blocks_sel ON work_order_blocks FOR SELECT
      USING (app_can_access_incident((SELECT a.incident_id FROM incident_actions a WHERE a.id = work_order_blocks.incident_action_id)));
    CREATE POLICY work_order_blocks_wr ON work_order_blocks FOR ALL
      USING (app_can_access_incident((SELECT a.incident_id FROM incident_actions a WHERE a.id = work_order_blocks.incident_action_id)))
      WITH CHECK (app_can_access_incident((SELECT a.incident_id FROM incident_actions a WHERE a.id = work_order_blocks.incident_action_id)));
  END IF;
END $$;

-- === machines: also visible if I'm assigned to an incident on that machine ===
-- (so the incident detail page can still show the machine for a cross-factory assignee)
DO $$ BEGIN
  IF to_regclass('public.machines') IS NOT NULL THEN
    DROP POLICY IF EXISTS machines_sel ON machines;
    CREATE POLICY machines_sel ON machines FOR SELECT
      USING (
        app_can_access(factory_id)
        OR EXISTS (SELECT 1 FROM incidents i
                   WHERE i.machine_id = machines.id
                     AND auth.uid() = ANY(i.assigned_user_ids))
      );
  END IF;
END $$;
