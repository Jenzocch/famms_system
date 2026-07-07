-- ============================================================================
-- RLS PHASE 3 — Step 2 of 3: create policies (STILL INERT).
--
-- Resilient version: every block is guarded by to_regclass(), so tables that
-- don't exist in this database are simply skipped instead of erroring.
--
-- Creating a policy does NOTHING until RLS is ENABLED on the table (step 3).
-- Run step 1 (helpers) first.
--
-- Visibility model:
--   SELECT  : app_can_access(factory) — own factory, or all for manager+/dir/admin
--   INSERT/UPDATE : same access scope
--   DELETE  : access scope + role gate
--   service_role (admin API) bypasses everything.
-- ============================================================================

-- === factories (row's own id IS the factory) ===
DO $$ BEGIN
  IF to_regclass('public.factories') IS NOT NULL THEN
    DROP POLICY IF EXISTS factories_sel ON factories;
    DROP POLICY IF EXISTS factories_wr  ON factories;
    CREATE POLICY factories_sel ON factories FOR SELECT USING (app_can_access(id));
    CREATE POLICY factories_wr  ON factories FOR ALL
      USING (app_is_manager_plus() AND app_can_access(id))
      WITH CHECK (app_is_manager_plus() AND app_can_access(id));
  END IF;
END $$;

-- === factory_id-scoped master tables (incl. pm_schedules), manager+ writes ===
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['departments','areas','machines','facilities','spare_parts','telegram_groups','telegram_users','projects','pm_schedules'] LOOP
    IF to_regclass('public.'||tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I_sel ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_wr  ON %I', tbl, tbl);
    EXECUTE format('CREATE POLICY %I_sel ON %I FOR SELECT USING (app_can_access(factory_id))', tbl, tbl);
    EXECUTE format('CREATE POLICY %I_wr ON %I FOR ALL USING (app_is_manager_plus() AND app_can_access(factory_id)) WITH CHECK (app_is_manager_plus() AND app_can_access(factory_id))', tbl, tbl);
  END LOOP;
END $$;

-- === maintenance_costs: read in factory; write supervisor+ ===
DO $$ BEGIN
  IF to_regclass('public.maintenance_costs') IS NOT NULL THEN
    DROP POLICY IF EXISTS maintenance_costs_sel ON maintenance_costs;
    DROP POLICY IF EXISTS maintenance_costs_wr  ON maintenance_costs;
    CREATE POLICY maintenance_costs_sel ON maintenance_costs FOR SELECT USING (app_can_access(factory_id));
    CREATE POLICY maintenance_costs_wr  ON maintenance_costs FOR ALL
      USING (app_is_supervisor_plus() AND app_can_access(factory_id))
      WITH CHECK (app_is_supervisor_plus() AND app_can_access(factory_id));
  END IF;
END $$;

-- === incidents ===
DO $$ BEGIN
  IF to_regclass('public.incidents') IS NOT NULL THEN
    DROP POLICY IF EXISTS incidents_sel ON incidents;
    DROP POLICY IF EXISTS incidents_ins ON incidents;
    DROP POLICY IF EXISTS incidents_upd ON incidents;
    DROP POLICY IF EXISTS incidents_del ON incidents;
    CREATE POLICY incidents_sel ON incidents FOR SELECT USING (app_can_access(factory_id));
    CREATE POLICY incidents_ins ON incidents FOR INSERT WITH CHECK (app_can_access(factory_id));
    CREATE POLICY incidents_upd ON incidents FOR UPDATE
      USING (app_can_access(factory_id)) WITH CHECK (app_can_access(factory_id));
    CREATE POLICY incidents_del ON incidents FOR DELETE
      USING (app_is_supervisor_plus() AND app_can_access(factory_id));
  END IF;
END $$;

-- === incident children scoped via parent incident's factory ===
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['incident_actions','incident_relations','incident_comments','incident_updates'] LOOP
    IF to_regclass('public.'||tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I_sel ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_wr  ON %I', tbl, tbl);
    EXECUTE format($f$CREATE POLICY %I_sel ON %I FOR SELECT
      USING (app_can_access((SELECT factory_id FROM incidents i WHERE i.id = %I.incident_id)))$f$, tbl, tbl, tbl);
    EXECUTE format($f$CREATE POLICY %I_wr ON %I FOR ALL
      USING (app_can_access((SELECT factory_id FROM incidents i WHERE i.id = %I.incident_id)))
      WITH CHECK (app_can_access((SELECT factory_id FROM incidents i WHERE i.id = %I.incident_id)))$f$, tbl, tbl, tbl, tbl);
  END LOOP;
END $$;

-- === work_order_blocks: grandchild via incident_action_id -> incident ===
DO $$ BEGIN
  IF to_regclass('public.work_order_blocks') IS NOT NULL THEN
    DROP POLICY IF EXISTS work_order_blocks_sel ON work_order_blocks;
    DROP POLICY IF EXISTS work_order_blocks_wr  ON work_order_blocks;
    CREATE POLICY work_order_blocks_sel ON work_order_blocks FOR SELECT
      USING (app_can_access((SELECT i.factory_id FROM incident_actions a JOIN incidents i ON i.id = a.incident_id WHERE a.id = work_order_blocks.incident_action_id)));
    CREATE POLICY work_order_blocks_wr ON work_order_blocks FOR ALL
      USING (app_can_access((SELECT i.factory_id FROM incident_actions a JOIN incidents i ON i.id = a.incident_id WHERE a.id = work_order_blocks.incident_action_id)))
      WITH CHECK (app_can_access((SELECT i.factory_id FROM incident_actions a JOIN incidents i ON i.id = a.incident_id WHERE a.id = work_order_blocks.incident_action_id)));
  END IF;
END $$;

-- === machine children scoped via machines.factory_id ===
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['machine_qr_codes','equipment_health_scores','maintenance_logs'] LOOP
    IF to_regclass('public.'||tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I_sel ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_wr  ON %I', tbl, tbl);
    EXECUTE format($f$CREATE POLICY %I_sel ON %I FOR SELECT
      USING (app_can_access((SELECT factory_id FROM machines m WHERE m.id = %I.machine_id)))$f$, tbl, tbl, tbl);
    EXECUTE format($f$CREATE POLICY %I_wr ON %I FOR ALL
      USING (app_can_access((SELECT factory_id FROM machines m WHERE m.id = %I.machine_id)))
      WITH CHECK (app_can_access((SELECT factory_id FROM machines m WHERE m.id = %I.machine_id)))$f$, tbl, tbl, tbl, tbl);
  END LOOP;
END $$;

-- === pm_records -> pm_schedules.factory_id (delete manager+) ===
DO $$ BEGIN
  IF to_regclass('public.pm_records') IS NOT NULL THEN
    DROP POLICY IF EXISTS pm_records_sel ON pm_records;
    DROP POLICY IF EXISTS pm_records_ins ON pm_records;
    DROP POLICY IF EXISTS pm_records_upd ON pm_records;
    DROP POLICY IF EXISTS pm_records_del ON pm_records;
    CREATE POLICY pm_records_sel ON pm_records FOR SELECT
      USING (app_can_access((SELECT factory_id FROM pm_schedules s WHERE s.id = pm_records.pm_schedule_id)));
    CREATE POLICY pm_records_ins ON pm_records FOR INSERT
      WITH CHECK (app_can_access((SELECT factory_id FROM pm_schedules s WHERE s.id = pm_records.pm_schedule_id)));
    CREATE POLICY pm_records_upd ON pm_records FOR UPDATE
      USING (app_can_access((SELECT factory_id FROM pm_schedules s WHERE s.id = pm_records.pm_schedule_id)));
    CREATE POLICY pm_records_del ON pm_records FOR DELETE
      USING (app_is_manager_plus() AND app_can_access((SELECT factory_id FROM pm_schedules s WHERE s.id = pm_records.pm_schedule_id)));
  END IF;
END $$;

-- === spare_part_transactions -> spare_parts.factory_id ===
DO $$ BEGIN
  IF to_regclass('public.spare_part_transactions') IS NOT NULL THEN
    DROP POLICY IF EXISTS spare_part_transactions_sel ON spare_part_transactions;
    DROP POLICY IF EXISTS spare_part_transactions_wr  ON spare_part_transactions;
    CREATE POLICY spare_part_transactions_sel ON spare_part_transactions FOR SELECT
      USING (app_can_access((SELECT factory_id FROM spare_parts p WHERE p.id = spare_part_transactions.part_id)));
    CREATE POLICY spare_part_transactions_wr ON spare_part_transactions FOR ALL
      USING (app_can_access((SELECT factory_id FROM spare_parts p WHERE p.id = spare_part_transactions.part_id)))
      WITH CHECK (app_can_access((SELECT factory_id FROM spare_parts p WHERE p.id = spare_part_transactions.part_id)));
  END IF;
END $$;

-- === reference/global tables: read any authenticated, write manager+ ===
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['failure_categories','failure_codes','facility_issue_categories'] LOOP
    IF to_regclass('public.'||tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I_sel ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_wr  ON %I', tbl, tbl);
    EXECUTE format('CREATE POLICY %I_sel ON %I FOR SELECT USING (auth.uid() IS NOT NULL)', tbl, tbl);
    EXECUTE format('CREATE POLICY %I_wr ON %I FOR ALL USING (app_is_manager_plus()) WITH CHECK (app_is_manager_plus())', tbl, tbl);
  END LOOP;
END $$;

-- === incident_types: admin writes ===
DO $$ BEGIN
  IF to_regclass('public.incident_types') IS NOT NULL THEN
    DROP POLICY IF EXISTS incident_types_sel ON incident_types;
    DROP POLICY IF EXISTS incident_types_wr  ON incident_types;
    CREATE POLICY incident_types_sel ON incident_types FOR SELECT USING (auth.uid() IS NOT NULL);
    CREATE POLICY incident_types_wr  ON incident_types FOR ALL
      USING (app_is_admin()) WITH CHECK (app_is_admin());
  END IF;
END $$;

-- === notification_logs: acting user inserts, manager+ reads ===
DO $$ BEGIN
  IF to_regclass('public.notification_logs') IS NOT NULL THEN
    DROP POLICY IF EXISTS notification_logs_sel ON notification_logs;
    DROP POLICY IF EXISTS notification_logs_ins ON notification_logs;
    CREATE POLICY notification_logs_sel ON notification_logs FOR SELECT USING (app_is_manager_plus());
    CREATE POLICY notification_logs_ins ON notification_logs FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
  END IF;
END $$;

-- === knowledge_base + rca_records: shared learning, supervisor+ writes ===
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['knowledge_base','rca_records'] LOOP
    IF to_regclass('public.'||tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I_sel ON %I', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_wr  ON %I', tbl, tbl);
    EXECUTE format('CREATE POLICY %I_sel ON %I FOR SELECT USING (auth.uid() IS NOT NULL)', tbl, tbl);
    EXECUTE format('CREATE POLICY %I_wr ON %I FOR ALL USING (app_is_supervisor_plus()) WITH CHECK (app_is_supervisor_plus())', tbl, tbl);
  END LOOP;
END $$;

-- === approval_logs ===
DO $$ BEGIN
  IF to_regclass('public.approval_logs') IS NOT NULL THEN
    DROP POLICY IF EXISTS approval_logs_sel ON approval_logs;
    DROP POLICY IF EXISTS approval_logs_ins ON approval_logs;
    CREATE POLICY approval_logs_sel ON approval_logs FOR SELECT USING (app_is_supervisor_plus());
    CREATE POLICY approval_logs_ins ON approval_logs FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
  END IF;
END $$;

-- === audit_logs ===
DO $$ BEGIN
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    DROP POLICY IF EXISTS audit_logs_sel ON audit_logs;
    DROP POLICY IF EXISTS audit_logs_ins ON audit_logs;
    DROP POLICY IF EXISTS audit_logs_del ON audit_logs;
    CREATE POLICY audit_logs_sel ON audit_logs FOR SELECT
      USING (app_is_supervisor_plus() AND app_can_access(factory_id));
    CREATE POLICY audit_logs_ins ON audit_logs FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
    CREATE POLICY audit_logs_del ON audit_logs FOR DELETE USING (app_is_admin());
  END IF;
END $$;

-- === profiles (MOST DELICATE — SELECT must allow reading own row) ===
DO $$ BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    DROP POLICY IF EXISTS profiles_sel ON profiles;
    DROP POLICY IF EXISTS profiles_ins ON profiles;
    DROP POLICY IF EXISTS profiles_upd ON profiles;
    DROP POLICY IF EXISTS profiles_del ON profiles;
    CREATE POLICY profiles_sel ON profiles FOR SELECT
      USING (id = auth.uid() OR app_can_access(factory_id));
    CREATE POLICY profiles_ins ON profiles FOR INSERT WITH CHECK (app_is_admin());
    CREATE POLICY profiles_upd ON profiles FOR UPDATE
      USING (id = auth.uid() OR app_is_admin())
      WITH CHECK (id = auth.uid() OR app_is_admin());
    CREATE POLICY profiles_del ON profiles FOR DELETE USING (app_is_admin());
  END IF;
END $$;
