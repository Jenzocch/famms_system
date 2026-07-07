-- ============================================================================
-- RLS PHASE 3 — Step 3 of 3: ENABLE RLS, ONE STAGE AT A TIME.
--
-- ⚠️  Run ONE stage, then TEST the live app with a non-admin account. If
--     anything breaks, run that stage's ROLLBACK block and tell me what broke.
--
-- Resilient: each stage loops over its tables and skips any that don't exist.
-- Prereqs: step 1 (helpers) and step 2 (policies) already run.
-- service_role (admin API) bypasses RLS, so user management keeps working.
-- ============================================================================

-- Helper to enable/disable a list, skipping missing tables:
--   SELECT rls_set(ARRAY['a','b'], true);   -- enable
--   SELECT rls_set(ARRAY['a','b'], false);  -- disable (rollback)
CREATE OR REPLACE FUNCTION rls_set(tables TEXT[], on_off BOOLEAN)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF to_regclass('public.'||tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE %I %s ROW LEVEL SECURITY', tbl,
                   CASE WHEN on_off THEN 'ENABLE' ELSE 'DISABLE' END);
  END LOOP;
END $$;


-- ─── STAGE A — reference / global tables (lowest risk) ──────────────────────
-- Test after: report-incident form dropdowns load; settings incident types list.
SELECT rls_set(ARRAY['failure_categories','failure_codes','facility_issue_categories','incident_types','notification_logs'], true);
-- ROLLBACK A:
-- SELECT rls_set(ARRAY['failure_categories','failure_codes','facility_issue_categories','incident_types','notification_logs'], false);


-- ─── STAGE B — tenant master data ───────────────────────────────────────────
-- Test after: machines/areas/factories/PM/spare parts/Telegram settings load;
-- a DIN user does NOT see SJA machines.
SELECT rls_set(ARRAY['factories','departments','areas','machines','facilities','spare_parts','telegram_groups','telegram_users','maintenance_costs','pm_schedules','projects'], true);
-- ROLLBACK B:
-- SELECT rls_set(ARRAY['factories','departments','areas','machines','facilities','spare_parts','telegram_groups','telegram_users','maintenance_costs','pm_schedules','projects'], false);


-- ─── STAGE C — incidents + children ─────────────────────────────────────────
-- Test after: board loads, new incident, add action, assign, comment, close.
SELECT rls_set(ARRAY['incidents','incident_actions','incident_relations','incident_comments','work_order_blocks','incident_updates','approval_logs'], true);
-- ROLLBACK C:
-- SELECT rls_set(ARRAY['incidents','incident_actions','incident_relations','incident_comments','work_order_blocks','incident_updates','approval_logs'], false);


-- ─── STAGE D — machine/PM/knowledge children + audit ────────────────────────
-- Test after: machine health trend, PM records, knowledge base, RCA, audit trail.
SELECT rls_set(ARRAY['machine_qr_codes','equipment_health_scores','maintenance_logs','pm_records','spare_part_transactions','knowledge_base','rca_records','audit_logs'], true);
-- ROLLBACK D:
-- SELECT rls_set(ARRAY['machine_qr_codes','equipment_health_scores','maintenance_logs','pm_records','spare_part_transactions','knowledge_base','rca_records','audit_logs'], false);


-- ─── STAGE E — profiles (LAST, most delicate) ───────────────────────────────
-- ⚠️  Keep a SECOND browser logged in as a non-admin first. After enabling,
--     verify: dashboard loads for a normal user, /profile shows name + saves a
--     name change, a technician can NOT change role/factory.
--     If login breaks → run ROLLBACK E immediately.
SELECT rls_set(ARRAY['profiles'], true);
-- ROLLBACK E:
-- SELECT rls_set(ARRAY['profiles'], false);
