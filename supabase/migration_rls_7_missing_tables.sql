-- ============================================================================
-- RLS 7 — three tables that post-date the staged RLS rollout (run in Supabase
-- SQL editor; idempotent)
-- ============================================================================
--
-- WHY: the production security check (2026-07) found telegram_report_drafts,
-- vendors and parts_requests with RLS still disabled. They were all created
-- AFTER migration_rls_2/3 were written, so the staged rollout never covered
-- them. anon has no table grants (phase 1), so this is not an unauthenticated
-- hole — but `authenticated` does have grants, so with RLS off ANY logged-in
-- account could read/write these three tables directly via the REST API,
-- across factories, ignoring every role gate the UI enforces (e.g. a
-- technician deactivating vendors, or flipping another factory's parts
-- request to 'received').
--
-- Also drops rls_set(): the one-time staged-rollout helper from
-- migration_rls_3. It is NOT exploitable as-is (SECURITY INVOKER — a caller
-- without ALTER TABLE just gets an error), but a function whose only purpose
-- is toggling RLS off has no business existing on a locked-down production
-- DB. Re-running migration_rls_3 recreates it if ever needed again.
--
-- Safe to run more than once. Test after: 叫料 (parts request) from an
-- incident, vendor list in AssignForm, vendor management in Settings, and a
-- /lapor Telegram report all still work.

-- ── telegram_report_drafts ──────────────────────────────────────────────────
-- Only ever touched by the Telegram webhook through the service-role client
-- (bypasses RLS). No browser path exists, so: RLS on, NO policies — every
-- client-key access is denied, the webhook is unaffected.
ALTER TABLE telegram_report_drafts ENABLE ROW LEVEL SECURITY;

-- ── vendors ─────────────────────────────────────────────────────────────────
-- Read from the browser by every role (AssignForm's vendor chips); written
-- only from Settings → 外包廠商名冊, which the app gates to manager+. Mirror
-- that at the DB layer. factory_id NULL = shared across factories.
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendors_select ON vendors;
CREATE POLICY vendors_select ON vendors FOR SELECT TO authenticated
  USING (factory_id IS NULL OR app_can_access(factory_id));

DROP POLICY IF EXISTS vendors_insert ON vendors;
CREATE POLICY vendors_insert ON vendors FOR INSERT TO authenticated
  WITH CHECK (app_is_manager_plus() AND (factory_id IS NULL OR app_can_access(factory_id)));

DROP POLICY IF EXISTS vendors_update ON vendors;
CREATE POLICY vendors_update ON vendors FOR UPDATE TO authenticated
  USING (app_is_manager_plus() AND (factory_id IS NULL OR app_can_access(factory_id)))
  WITH CHECK (app_is_manager_plus() AND (factory_id IS NULL OR app_can_access(factory_id)));

DROP POLICY IF EXISTS vendors_delete ON vendors;
CREATE POLICY vendors_delete ON vendors FOR DELETE TO authenticated
  USING (app_is_manager_plus() AND (factory_id IS NULL OR app_can_access(factory_id)));

-- ── parts_requests ──────────────────────────────────────────────────────────
-- Created/updated/deleted by the logged-in requester through
-- /api/gudang/request (server client = the user's own session, NOT service
-- role), read on the incident detail/print pages. Gudang One's status
-- write-back uses the service-role client and bypasses RLS. Scope everything
-- to the user's factory (cross-factory accounts pass app_can_access for any
-- factory); NULL factory_id (factory deleted, SET NULL) stays visible so the
-- row doesn't vanish from the incident's tracker.
ALTER TABLE parts_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parts_requests_select ON parts_requests;
CREATE POLICY parts_requests_select ON parts_requests FOR SELECT TO authenticated
  USING (factory_id IS NULL OR app_can_access(factory_id));

DROP POLICY IF EXISTS parts_requests_insert ON parts_requests;
CREATE POLICY parts_requests_insert ON parts_requests FOR INSERT TO authenticated
  WITH CHECK (factory_id IS NULL OR app_can_access(factory_id));

DROP POLICY IF EXISTS parts_requests_update ON parts_requests;
CREATE POLICY parts_requests_update ON parts_requests FOR UPDATE TO authenticated
  USING (factory_id IS NULL OR app_can_access(factory_id))
  WITH CHECK (factory_id IS NULL OR app_can_access(factory_id));

DROP POLICY IF EXISTS parts_requests_delete ON parts_requests;
CREATE POLICY parts_requests_delete ON parts_requests FOR DELETE TO authenticated
  USING (factory_id IS NULL OR app_can_access(factory_id));

-- ── drop the rollout helper ─────────────────────────────────────────────────
DROP FUNCTION IF EXISTS rls_set(TEXT[], BOOLEAN);

-- ── sanity check — both rows should say ✅ ──────────────────────────────────
SELECT '1. RLS 未開啟的表' AS check,
  COALESCE(string_agg(tablename, ', '), '✅ 全部已開啟') AS result
FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity
UNION ALL
SELECT '2. rls_set 函式',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='rls_set') THEN '❌ 仍存在' ELSE '✅ 已移除' END;
