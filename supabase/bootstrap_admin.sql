-- ============================================================
-- Bootstrap the first admin account
-- ============================================================
-- Registration is disabled in the app — all accounts are created
-- by an admin. This chicken-and-egg means the FIRST admin must be
-- created manually:
--
--   1. In the Supabase Dashboard → Authentication → Users → "Add user"
--      Create a user with an email + password (tick "Auto Confirm User").
--
--   2. The on_auth_user_created trigger auto-creates a profile with
--      role 'technician'. Promote that account to 'admin' below by
--      replacing the email, then run this script in the SQL editor.
--
-- After this, log in with that account and manage all other users
-- from 設定 → 帳號管理 inside the app.
-- ============================================================

UPDATE public.profiles p
SET role = 'admin',
    is_active = true,
    updated_at = NOW()
FROM auth.users u
WHERE u.id = p.id
  AND u.email = 'a0811332331@gmail.com';

-- Verify:
SELECT u.email, p.role, p.is_active
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
ORDER BY p.role;
