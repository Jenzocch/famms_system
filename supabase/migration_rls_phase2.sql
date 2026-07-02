-- ============================================================================
-- RLS — PHASE 2: enforce per-role data access (fine-grained control)
-- ============================================================================
-- Problem: Phase 1 allows any authenticated user to read/write ALL data.
-- Phase 2 narrows access by role:
--   * technician: own incidents (reported_by_id OR assigned_user_ids) + own PM assignments
--   * supervisor: factory-wide incidents/PM (can manage team)
--   * manager: factory-wide + can approve PM/incidents
--   * director: factory-wide + RCA override
--   * admin: bypass everything (service_role unaffected)
--
-- Non-Data Tables (no RLS): factories, areas, departments, failure_categories,
-- failure_codes, facility_issue_categories (reference data, all roles read)
--
-- Safe to re-run: DROP POLICY IF EXISTS before CREATE.
-- Rollback: Run migration_rls_phase1.sql to revert to Phase 1 (blanket authenticated).
-- ============================================================================

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Get current user's role
CREATE OR REPLACE FUNCTION auth.user_role()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT role INTO user_role FROM profiles WHERE id = auth.uid();
  RETURN COALESCE(user_role, 'technician');
END;
$$;

-- Get current user's factory_id
CREATE OR REPLACE FUNCTION auth.user_factory_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  factory_id UUID;
BEGIN
  SELECT factory_id INTO factory_id FROM profiles WHERE id = auth.uid();
  RETURN factory_id;
END;
$$;

-- Check if current user is admin
CREATE OR REPLACE FUNCTION auth.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN auth.user_role() = 'admin';
END;
$$;

-- ============================================================================
-- PROFILES — User can read own profile + admin can read all
-- ============================================================================

DROP POLICY IF EXISTS profiles_own_read ON profiles;
CREATE POLICY profiles_own_read ON profiles FOR SELECT
  USING (
    id = auth.uid()
    OR auth.is_admin()
  );

DROP POLICY IF EXISTS profiles_own_update ON profiles;
CREATE POLICY profiles_own_update ON profiles FOR UPDATE
  USING (
    id = auth.uid()
    OR auth.is_admin()
  )
  WITH CHECK (
    id = auth.uid()
    OR auth.is_admin()
  );

-- Admin can insert new profiles (e.g., for tests)
DROP POLICY IF EXISTS profiles_admin_insert ON profiles;
CREATE POLICY profiles_admin_insert ON profiles FOR INSERT
  WITH CHECK (auth.is_admin());

-- ============================================================================
-- MACHINES — Read: own factory + supervisor/manager/director. Write: supervisor+
-- ============================================================================

DROP POLICY IF EXISTS machines_factory_read ON machines;
CREATE POLICY machines_factory_read ON machines FOR SELECT
  USING (
    factory_id = auth.user_factory_id()
    OR auth.is_admin()
  );

DROP POLICY IF EXISTS machines_supervisor_write ON machines;
CREATE POLICY machines_supervisor_write ON machines FOR UPDATE
  USING (
    (auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
     AND factory_id = auth.user_factory_id())
    OR auth.is_admin()
  )
  WITH CHECK (
    (auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
     AND factory_id = auth.user_factory_id())
    OR auth.is_admin()
  );

DROP POLICY IF EXISTS machines_supervisor_insert ON machines;
CREATE POLICY machines_supervisor_insert ON machines FOR INSERT
  WITH CHECK (
    (auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
     AND factory_id = auth.user_factory_id())
    OR auth.is_admin()
  );

-- ============================================================================
-- FACILITIES — Same as machines (factory-scoped read, supervisor+ write)
-- ============================================================================

DROP POLICY IF EXISTS facilities_factory_read ON facilities;
CREATE POLICY facilities_factory_read ON facilities FOR SELECT
  USING (
    factory_id = auth.user_factory_id()
    OR auth.is_admin()
  );

DROP POLICY IF EXISTS facilities_supervisor_write ON facilities;
CREATE POLICY facilities_supervisor_write ON facilities FOR UPDATE
  USING (
    (auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
     AND factory_id = auth.user_factory_id())
    OR auth.is_admin()
  )
  WITH CHECK (
    (auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
     AND factory_id = auth.user_factory_id())
    OR auth.is_admin()
  );

DROP POLICY IF EXISTS facilities_supervisor_insert ON facilities;
CREATE POLICY facilities_supervisor_insert ON facilities FOR INSERT
  WITH CHECK (
    (auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
     AND factory_id = auth.user_factory_id())
    OR auth.is_admin()
  );

-- ============================================================================
-- INCIDENTS — Complex: technician sees own, supervisor+ sees factory
-- ============================================================================
-- Technician: incidents where (reported_by_id = me OR me in assigned_user_ids)
--             + factory_id = my_factory
-- Supervisor+: all factory incidents
-- Admin: all incidents
-- Write rules more restrictive (add later, for now allow as Phase 1)

DROP POLICY IF EXISTS incidents_technician_read ON incidents;
CREATE POLICY incidents_technician_read ON incidents FOR SELECT
  USING (
    factory_id = auth.user_factory_id()
    AND (
      auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
      OR reported_by_id = auth.uid()
      OR assigned_user_ids @> ARRAY[auth.uid()]
    )
  );

DROP POLICY IF EXISTS incidents_admin_all ON incidents;
CREATE POLICY incidents_admin_all ON incidents FOR ALL
  USING (auth.is_admin())
  WITH CHECK (auth.is_admin());

-- For now, allow authenticated to write incidents (will be tightened in Phase 3)
DROP POLICY IF EXISTS incidents_write ON incidents;
CREATE POLICY incidents_write ON incidents FOR INSERT
  WITH CHECK (factory_id = auth.user_factory_id());

DROP POLICY IF EXISTS incidents_update ON incidents;
CREATE POLICY incidents_update ON incidents FOR UPDATE
  USING (factory_id = auth.user_factory_id())
  WITH CHECK (factory_id = auth.user_factory_id());

-- ============================================================================
-- INCIDENT_ACTIONS — Same as incidents (tied to incident visibility)
-- ============================================================================

DROP POLICY IF EXISTS incident_actions_via_incident ON incident_actions;
CREATE POLICY incident_actions_via_incident ON incident_actions FOR SELECT
  USING (
    incident_id IN (
      SELECT id FROM incidents
      WHERE factory_id = auth.user_factory_id()
        AND (
          auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
          OR reported_by_id = auth.uid()
          OR assigned_user_ids @> ARRAY[auth.uid()]
        )
    )
    OR auth.is_admin()
  );

DROP POLICY IF EXISTS incident_actions_write ON incident_actions;
CREATE POLICY incident_actions_write ON incident_actions FOR INSERT
  WITH CHECK (
    incident_id IN (
      SELECT id FROM incidents WHERE factory_id = auth.user_factory_id()
    )
  );

DROP POLICY IF EXISTS incident_actions_update ON incident_actions;
CREATE POLICY incident_actions_update ON incident_actions FOR UPDATE
  USING (
    incident_id IN (
      SELECT id FROM incidents WHERE factory_id = auth.user_factory_id()
    )
  )
  WITH CHECK (
    incident_id IN (
      SELECT id FROM incidents WHERE factory_id = auth.user_factory_id()
    )
  );

-- ============================================================================
-- INCIDENT_RELATIONS — Same visibility as incidents
-- ============================================================================

DROP POLICY IF EXISTS incident_relations_read ON incident_relations;
CREATE POLICY incident_relations_read ON incident_relations FOR SELECT
  USING (
    incident_id IN (
      SELECT id FROM incidents
      WHERE factory_id = auth.user_factory_id()
        AND (
          auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
          OR reported_by_id = auth.uid()
          OR assigned_user_ids @> ARRAY[auth.uid()]
        )
    )
    OR auth.is_admin()
  );

DROP POLICY IF EXISTS incident_relations_write ON incident_relations;
CREATE POLICY incident_relations_write ON incident_relations FOR INSERT
  WITH CHECK (
    incident_id IN (
      SELECT id FROM incidents WHERE factory_id = auth.user_factory_id()
    )
  );

-- ============================================================================
-- INCIDENT_COMMENTS — Tied to incident visibility
-- ============================================================================

DROP POLICY IF EXISTS incident_comments_read ON incident_comments;
CREATE POLICY incident_comments_read ON incident_comments FOR SELECT
  USING (
    incident_id IN (
      SELECT id FROM incidents
      WHERE factory_id = auth.user_factory_id()
        AND (
          auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
          OR reported_by_id = auth.uid()
          OR assigned_user_ids @> ARRAY[auth.uid()]
        )
    )
    OR auth.is_admin()
  );

DROP POLICY IF EXISTS incident_comments_write ON incident_comments;
CREATE POLICY incident_comments_write ON incident_comments FOR INSERT
  WITH CHECK (
    incident_id IN (
      SELECT id FROM incidents WHERE factory_id = auth.user_factory_id()
    )
  );

-- ============================================================================
-- WORK_ORDER_BLOCKS — Tied to incident_action → incident
-- ============================================================================

DROP POLICY IF EXISTS work_order_blocks_read ON work_order_blocks;
CREATE POLICY work_order_blocks_read ON work_order_blocks FOR SELECT
  USING (
    incident_action_id IN (
      SELECT id FROM incident_actions
      WHERE incident_id IN (
        SELECT id FROM incidents
        WHERE factory_id = auth.user_factory_id()
          AND (
            auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
            OR reported_by_id = auth.uid()
            OR assigned_user_ids @> ARRAY[auth.uid()]
          )
      )
    )
    OR auth.is_admin()
  );

DROP POLICY IF EXISTS work_order_blocks_write ON work_order_blocks;
CREATE POLICY work_order_blocks_write ON work_order_blocks FOR INSERT
  WITH CHECK (
    incident_action_id IN (
      SELECT id FROM incident_actions
      WHERE incident_id IN (
        SELECT id FROM incidents WHERE factory_id = auth.user_factory_id()
      )
    )
  );

-- ============================================================================
-- PM_SCHEDULES — Technician sees own assignments, supervisor+ sees all
-- ============================================================================

DROP POLICY IF EXISTS pm_schedules_tech_read ON pm_schedules;
CREATE POLICY pm_schedules_tech_read ON pm_schedules FOR SELECT
  USING (
    factory_id = auth.user_factory_id()
    AND (
      auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
      OR assigned_user_ids @> ARRAY[auth.uid()]
    )
  );

DROP POLICY IF EXISTS pm_schedules_admin_all ON pm_schedules;
CREATE POLICY pm_schedules_admin_all ON pm_schedules FOR ALL
  USING (auth.is_admin())
  WITH CHECK (auth.is_admin());

DROP POLICY IF EXISTS pm_schedules_supervisor_write ON pm_schedules;
CREATE POLICY pm_schedules_supervisor_write ON pm_schedules FOR UPDATE
  USING (
    (auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
     AND factory_id = auth.user_factory_id())
    OR auth.is_admin()
  )
  WITH CHECK (
    (auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
     AND factory_id = auth.user_factory_id())
    OR auth.is_admin()
  );

DROP POLICY IF EXISTS pm_schedules_supervisor_insert ON pm_schedules;
CREATE POLICY pm_schedules_supervisor_insert ON pm_schedules FOR INSERT
  WITH CHECK (
    (auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
     AND factory_id = auth.user_factory_id())
    OR auth.is_admin()
  );

-- ============================================================================
-- PM_RECORDS — Technician can complete own assignments, supervisor+ manage all
-- ============================================================================

DROP POLICY IF EXISTS pm_records_via_schedule ON pm_records;
CREATE POLICY pm_records_via_schedule FOR SELECT
  USING (
    pm_schedule_id IN (
      SELECT id FROM pm_schedules
      WHERE factory_id = auth.user_factory_id()
        AND (
          auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
          OR assigned_user_ids @> ARRAY[auth.uid()]
        )
    )
    OR auth.is_admin()
  );

DROP POLICY IF EXISTS pm_records_insert ON pm_records;
CREATE POLICY pm_records_insert ON pm_records FOR INSERT
  WITH CHECK (
    pm_schedule_id IN (
      SELECT id FROM pm_schedules WHERE factory_id = auth.user_factory_id()
    )
  );

DROP POLICY IF EXISTS pm_records_update ON pm_records;
CREATE POLICY pm_records_update ON pm_records FOR UPDATE
  USING (
    pm_schedule_id IN (
      SELECT id FROM pm_schedules WHERE factory_id = auth.user_factory_id()
    )
  )
  WITH CHECK (
    pm_schedule_id IN (
      SELECT id FROM pm_schedules WHERE factory_id = auth.user_factory_id()
    )
  );

-- ============================================================================
-- SPARE_PARTS — All factory users can read, supervisor+ write
-- ============================================================================

DROP POLICY IF EXISTS spare_parts_factory_read ON spare_parts;
CREATE POLICY spare_parts_factory_read ON spare_parts FOR SELECT
  USING (factory_id = auth.user_factory_id());

DROP POLICY IF EXISTS spare_parts_supervisor_write ON spare_parts;
CREATE POLICY spare_parts_supervisor_write ON spare_parts FOR UPDATE
  USING (
    (auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
     AND factory_id = auth.user_factory_id())
    OR auth.is_admin()
  )
  WITH CHECK (
    (auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
     AND factory_id = auth.user_factory_id())
    OR auth.is_admin()
  );

DROP POLICY IF EXISTS spare_parts_supervisor_insert ON spare_parts;
CREATE POLICY spare_parts_supervisor_insert ON spare_parts FOR INSERT
  WITH CHECK (
    (auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
     AND factory_id = auth.user_factory_id())
    OR auth.is_admin()
  );

-- ============================================================================
-- SPARE_PART_TRANSACTIONS — Tied to incident_action visibility
-- ============================================================================

DROP POLICY IF EXISTS spare_part_transactions_factory ON spare_part_transactions;
CREATE POLICY spare_part_transactions_factory FOR SELECT
  USING (factory_id = auth.user_factory_id());

DROP POLICY IF EXISTS spare_part_transactions_write ON spare_part_transactions;
CREATE POLICY spare_part_transactions_write ON spare_part_transactions FOR INSERT
  WITH CHECK (factory_id = auth.user_factory_id());

-- ============================================================================
-- NOTIFICATION TABLES (telegram_users, telegram_groups) — Users see own subs
-- ============================================================================

DROP POLICY IF EXISTS telegram_users_own ON telegram_users;
CREATE POLICY telegram_users_own ON telegram_users FOR SELECT
  USING (
    user_id = auth.uid()
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

DROP POLICY IF EXISTS telegram_users_manage_own ON telegram_users;
CREATE POLICY telegram_users_manage_own ON telegram_users FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS telegram_users_update_own ON telegram_users;
CREATE POLICY telegram_users_update_own ON telegram_users FOR UPDATE
  USING (
    user_id = auth.uid()
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

DROP POLICY IF EXISTS telegram_groups_factory ON telegram_groups;
CREATE POLICY telegram_groups_factory ON telegram_groups FOR SELECT
  USING (
    factory_id = auth.user_factory_id()
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

DROP POLICY IF EXISTS telegram_groups_supervisor ON telegram_groups;
CREATE POLICY telegram_groups_supervisor ON telegram_groups FOR INSERT
  WITH CHECK (
    (auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
     AND factory_id = auth.user_factory_id())
    OR auth.is_admin()
  );

-- ============================================================================
-- KNOWLEDGE_BASE — All factory users can read (reference), supervisor+ write
-- ============================================================================

DROP POLICY IF EXISTS knowledge_base_factory_read ON knowledge_base;
CREATE POLICY knowledge_base_factory_read ON knowledge_base FOR SELECT
  USING (factory_id = auth.user_factory_id());

DROP POLICY IF EXISTS knowledge_base_supervisor_write ON knowledge_base;
CREATE POLICY knowledge_base_supervisor_write ON knowledge_base FOR UPDATE
  USING (
    (auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
     AND factory_id = auth.user_factory_id())
    OR auth.is_admin()
  )
  WITH CHECK (
    (auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
     AND factory_id = auth.user_factory_id())
    OR auth.is_admin()
  );

DROP POLICY IF EXISTS knowledge_base_supervisor_insert ON knowledge_base;
CREATE POLICY knowledge_base_supervisor_insert ON knowledge_base FOR INSERT
  WITH CHECK (
    (auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
     AND factory_id = auth.user_factory_id())
    OR auth.is_admin()
  );

-- ============================================================================
-- EQUIPMENT_HEALTH_SCORES — All factory users read, system write only
-- ============================================================================

DROP POLICY IF EXISTS equipment_health_scores_read ON equipment_health_scores;
CREATE POLICY equipment_health_scores_read ON equipment_health_scores FOR SELECT
  USING (factory_id = auth.user_factory_id());

-- Health scores auto-updated by trigger, no user write

-- ============================================================================
-- RCA_RECORDS — Tied to incident visibility, director+ write
-- ============================================================================

DROP POLICY IF EXISTS rca_records_via_incident ON rca_records;
CREATE POLICY rca_records_via_incident FOR SELECT
  USING (
    incident_id IN (
      SELECT id FROM incidents
      WHERE factory_id = auth.user_factory_id()
        AND (
          auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
          OR reported_by_id = auth.uid()
          OR assigned_user_ids @> ARRAY[auth.uid()]
        )
    )
    OR auth.is_admin()
  );

DROP POLICY IF EXISTS rca_records_director_write ON rca_records;
CREATE POLICY rca_records_director_write ON rca_records FOR INSERT
  WITH CHECK (
    (auth.user_role() IN ('director', 'manager', 'admin')
     AND incident_id IN (SELECT id FROM incidents WHERE factory_id = auth.user_factory_id()))
    OR auth.is_admin()
  );

-- ============================================================================
-- NOTIFICATION_LOGS — Supervisor+ only (audit trail)
-- ============================================================================

DROP POLICY IF EXISTS notification_logs_supervisor ON notification_logs;
CREATE POLICY notification_logs_supervisor ON notification_logs FOR SELECT
  USING (
    (auth.user_role() IN ('supervisor', 'manager', 'director', 'admin')
     AND factory_id = auth.user_factory_id())
    OR auth.is_admin()
  );

-- ============================================================================
-- MACHINE_QR_CODES — Tied to machine visibility
-- ============================================================================

DROP POLICY IF EXISTS machine_qr_codes_via_machine ON machine_qr_codes;
CREATE POLICY machine_qr_codes_via_machine FOR SELECT
  USING (
    machine_id IN (
      SELECT id FROM machines WHERE factory_id = auth.user_factory_id()
    )
    OR auth.is_admin()
  );

-- ============================================================================
-- CLEANUP: Drop Phase 1 blanket policies (kept from Phase 1 migration)
-- ============================================================================
-- Phase 1 created a blanket "authenticated_all" policy on every table.
-- Now that Phase 2 has role-specific policies, drop the old blanket policy
-- to prevent it from bypassing Phase 2 rules.

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename = pg_tables.tablename AND policyname = 'authenticated_all')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS authenticated_all ON public.%I', r.tablename);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (revert to Phase 1) — uncomment and run:
-- ============================================================================
-- Run migration_rls_phase1.sql to re-enable the blanket authenticated policy
-- and drop all Phase 2 fine-grained policies. This will restore full factory
-- access to all authenticated users.
