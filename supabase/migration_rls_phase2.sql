-- ============================================================================
-- RLS — PHASE 2: per-role row policies (run AFTER migration_rls_phase1.sql)
-- ============================================================================
-- Phase 1 = any logged-in user can touch everything; anon fully blocked.
-- Phase 2 tightens the tables that matter, mirroring src/lib/permissions.ts:
--
--   profiles        read: all logged-in (needed for name joins / assignee pickers)
--                   update: self (role change blocked!) or admin — closes the
--                   "technician PATCHes own role to admin via REST" escalation.
--   incidents       read/update: supervisor+ see all; technician sees only cases
--                   they reported or are assigned to (matches the board filter).
--                   insert: everyone (report). delete: supervisor+.
--   incident_updates / incident_actions / incident_comments /
--   incident_relations / work_order_blocks
--                   follow their parent incident's visibility automatically.
--   pm_schedules    read: everyone (PM calendar). write: supervisor+ backstop
--                   (app UI further limits schedule management to admin).
--   audit_logs      insert-only for users; read supervisor+; NO update/delete
--                   policy at all → audit trail is tamper-proof from clients.
--
-- Everything else (machines, areas, factories, failure codes, spare parts,
-- knowledge base, telegram, pm_records, …) keeps the Phase 1 blanket
-- "authenticated_all" policy — reference data all roles legitimately need.
--
-- PERFORMANCE: helper functions are LANGUAGE sql + STABLE, and every policy
-- wraps them in (SELECT …) so Postgres evaluates them ONCE per query (initplan)
-- instead of once per row — page loads stay fast. Child tables join their
-- parent by primary key. Supporting indexes added at the bottom.
--
-- NULL factory_id (cross-factory admin/director accounts and cross-factory
-- incidents) is respected: Phase 2 scopes by ROLE, not by factory, because the
-- dashboard's factory-comparison view legitimately reads across factories.
--
-- Safe to re-run. Rollback: re-run migration_rls_phase1.sql (restores the
-- blanket policy), then drop the policies created here if desired.
-- ============================================================================

-- ============================================================================
-- HELPER FUNCTIONS (public schema — Supabase does not allow creating in auth.*)
-- SECURITY DEFINER lets them read profiles without recursive RLS lookups.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.user_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((SELECT role FROM profiles WHERE id = auth.uid()), 'technician')
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.user_role() = 'admin'
$$;

CREATE OR REPLACE FUNCTION public.is_supervisor_up()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.user_role() IN ('supervisor', 'manager', 'director', 'admin')
$$;

-- Remove Phase 2 v1 leftovers if an earlier attempt partially ran.
DROP FUNCTION IF EXISTS public.user_factory_id();

-- ============================================================================
-- PROFILES — read open (name joins everywhere); self-update cannot change role
-- ============================================================================

DROP POLICY IF EXISTS authenticated_all ON profiles;

DROP POLICY IF EXISTS profiles_read ON profiles;
CREATE POLICY profiles_read ON profiles FOR SELECT TO authenticated
  USING (true);

-- WITH CHECK compares the NEW row's role against the CURRENT stored role via
-- user_role() (SECURITY DEFINER reads the pre-update value) → a user can edit
-- their own name/settings but CANNOT change their own role. Admin can.
DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update ON profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  WITH CHECK (
    (SELECT public.is_admin())
    OR (id = (SELECT auth.uid()) AND role = (SELECT public.user_role()))
  );

-- Signup inserts go through the on_auth_user_created trigger (SECURITY DEFINER,
-- table owner → bypasses RLS). Client-side inserts: admin only.
DROP POLICY IF EXISTS profiles_insert ON profiles;
CREATE POLICY profiles_insert ON profiles FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS profiles_delete ON profiles;
CREATE POLICY profiles_delete ON profiles FOR DELETE TO authenticated
  USING ((SELECT public.is_admin()));

-- ============================================================================
-- INCIDENTS — supervisor+ full; technician/staff only own (reported or assigned)
-- ============================================================================

DROP POLICY IF EXISTS authenticated_all ON incidents;

DROP POLICY IF EXISTS incidents_read ON incidents;
CREATE POLICY incidents_read ON incidents FOR SELECT TO authenticated
  USING (
    (SELECT public.is_supervisor_up())
    OR reported_by_id = (SELECT auth.uid())
    OR assigned_user_ids @> ARRAY[(SELECT auth.uid())]
  );

DROP POLICY IF EXISTS incidents_insert ON incidents;
CREATE POLICY incidents_insert ON incidents FOR INSERT TO authenticated
  WITH CHECK (true);  -- everyone can report (PERMISSIONS.reportIncident)

DROP POLICY IF EXISTS incidents_update ON incidents;
CREATE POLICY incidents_update ON incidents FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_supervisor_up())
    OR reported_by_id = (SELECT auth.uid())
    OR assigned_user_ids @> ARRAY[(SELECT auth.uid())]
  )
  WITH CHECK (
    (SELECT public.is_supervisor_up())
    OR reported_by_id = (SELECT auth.uid())
    OR assigned_user_ids @> ARRAY[(SELECT auth.uid())]
  );

DROP POLICY IF EXISTS incidents_delete ON incidents;
CREATE POLICY incidents_delete ON incidents FOR DELETE TO authenticated
  USING ((SELECT public.is_supervisor_up()));

-- ============================================================================
-- INCIDENT CHILD TABLES — visibility follows the parent incident.
-- The EXISTS subquery runs under the caller's RLS, so if you can't see the
-- incident, you can't see (or write) its updates/actions/comments either.
-- ============================================================================

-- ---- incident_updates (處理紀錄時間軸) ----
DROP POLICY IF EXISTS authenticated_all ON incident_updates;

DROP POLICY IF EXISTS incident_updates_rw ON incident_updates;
CREATE POLICY incident_updates_rw ON incident_updates FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM incidents i WHERE i.id = incident_id))
  WITH CHECK (EXISTS (SELECT 1 FROM incidents i WHERE i.id = incident_id));

-- ---- incident_actions ----
DROP POLICY IF EXISTS authenticated_all ON incident_actions;

DROP POLICY IF EXISTS incident_actions_rw ON incident_actions;
CREATE POLICY incident_actions_rw ON incident_actions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM incidents i WHERE i.id = incident_id))
  WITH CHECK (EXISTS (SELECT 1 FROM incidents i WHERE i.id = incident_id));

-- ---- incident_comments ----
DROP POLICY IF EXISTS authenticated_all ON incident_comments;

DROP POLICY IF EXISTS incident_comments_rw ON incident_comments;
CREATE POLICY incident_comments_rw ON incident_comments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM incidents i WHERE i.id = incident_id))
  WITH CHECK (EXISTS (SELECT 1 FROM incidents i WHERE i.id = incident_id));

-- ---- incident_relations ----
DROP POLICY IF EXISTS authenticated_all ON incident_relations;

DROP POLICY IF EXISTS incident_relations_rw ON incident_relations;
CREATE POLICY incident_relations_rw ON incident_relations FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM incidents i WHERE i.id = incident_id))
  WITH CHECK (EXISTS (SELECT 1 FROM incidents i WHERE i.id = incident_id));

-- ---- work_order_blocks (parent = incident_actions → incidents) ----
DROP POLICY IF EXISTS authenticated_all ON work_order_blocks;

DROP POLICY IF EXISTS work_order_blocks_rw ON work_order_blocks;
CREATE POLICY work_order_blocks_rw ON work_order_blocks FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM incident_actions a WHERE a.id = incident_action_id))
  WITH CHECK (EXISTS (SELECT 1 FROM incident_actions a WHERE a.id = incident_action_id));

-- ============================================================================
-- PM_SCHEDULES — everyone reads (calendar); supervisor+ writes (backstop;
-- the app UI further restricts schedule management to admin)
-- ============================================================================

DROP POLICY IF EXISTS authenticated_all ON pm_schedules;

DROP POLICY IF EXISTS pm_schedules_read ON pm_schedules;
CREATE POLICY pm_schedules_read ON pm_schedules FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS pm_schedules_insert ON pm_schedules;
CREATE POLICY pm_schedules_insert ON pm_schedules FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_supervisor_up()));

DROP POLICY IF EXISTS pm_schedules_update ON pm_schedules;
CREATE POLICY pm_schedules_update ON pm_schedules FOR UPDATE TO authenticated
  USING ((SELECT public.is_supervisor_up()))
  WITH CHECK ((SELECT public.is_supervisor_up()));

DROP POLICY IF EXISTS pm_schedules_delete ON pm_schedules;
CREATE POLICY pm_schedules_delete ON pm_schedules FOR DELETE TO authenticated
  USING ((SELECT public.is_supervisor_up()));

-- pm_records intentionally keep the Phase 1 blanket policy — technicians must
-- freely insert/update completion records.

-- ============================================================================
-- AUDIT_LOGS — insert-only for users; supervisor+ read; NO update/delete
-- policies → clients cannot tamper with the audit trail. (service_role and
-- the incident_audit_trail view, owned by postgres, are unaffected.)
-- ============================================================================

DROP POLICY IF EXISTS authenticated_all ON audit_logs;

DROP POLICY IF EXISTS audit_logs_insert ON audit_logs;
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS audit_logs_read ON audit_logs;
CREATE POLICY audit_logs_read ON audit_logs FOR SELECT TO authenticated
  USING ((SELECT public.is_supervisor_up()));

-- ============================================================================
-- SUPPORTING INDEXES (policy predicates must stay index-backed)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_incidents_reported_by ON incidents(reported_by_id);
-- GIN index on incidents.assigned_user_ids already exists (migration_multi_assignee).

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFY — should list only the tables above with their new policies
-- ============================================================================
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles','incidents','incident_updates','incident_actions',
                    'incident_comments','incident_relations','work_order_blocks',
                    'pm_schedules','audit_logs')
ORDER BY tablename, policyname;
