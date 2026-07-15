import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { accountNameToEmail, isValidLoginName } from '@/lib/login-name'
import type { UserRole } from '@/types'

const VALID_ROLES: UserRole[] = ['technician', 'supervisor', 'manager', 'director', 'admin']

// GET — list all users, admin only.
// Source of truth is the profiles table (always reliable). Emails come from the
// auth admin API as a best-effort enrichment — if that call fails (network,
// key, proxy), we still return the user list instead of crashing the page.
export async function GET() {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: '無權限' }, { status: guard.status })

  const admin = createAdminClient()

  const { data: profiles, error: profErr } = await admin
    .from('profiles')
    .select('id, factory_id, full_name, role, custom_role_key, is_active, is_shared_device, created_at')
  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 })

  // Best-effort email lookup. Never let a failure here break the whole list.
  const emailById = new Map<string, string>()
  try {
    const { data: authData, error: authErr } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (!authErr && authData?.users) {
      for (const u of authData.users) emailById.set(u.id, u.email ?? '')
    }
  } catch (e) {
    console.error('listUsers failed (returning profiles without emails):', e)
  }

  // So the edit form can prefill "already has a Telegram chat_id registered"
  // without a second round-trip from the client.
  const telegramByProfileId = new Map<string, number>()
  const { data: tgUsers } = await admin.from('telegram_users').select('profile_id, telegram_chat_id')
  for (const t of tgUsers ?? []) telegramByProfileId.set(t.profile_id, t.telegram_chat_id)

  const users = (profiles ?? []).map(p => ({
    id: p.id,
    email: emailById.get(p.id) ?? '',
    full_name: p.full_name ?? '',
    role: (p.role ?? 'technician') as UserRole,
    custom_role_key: p.custom_role_key ?? null,
    factory_id: p.factory_id ?? null,
    is_active: p.is_active ?? true,
    is_shared_device: p.is_shared_device ?? false,
    created_at: p.created_at,
    telegram_chat_id: telegramByProfileId.get(p.id) ?? null,
  }))

  // newest first
  users.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))

  return NextResponse.json({ users })
}

// POST — create a new user (admin only)
export async function POST(req: Request) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: '無權限' }, { status: guard.status })

  let body: {
    email?: string
    password?: string
    full_name?: string
    role?: string
    custom_role_key?: string | null
    factory_id?: string
    telegram_chat_id?: string | number
    is_shared_device?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '無效的請求' }, { status: 400 })
  }

  const password = body.password ?? ''
  const full_name = body.full_name?.trim() || null
  const factory_id = body.factory_id || null

  const admin = createAdminClient()

  // A custom role (Settings → 角色管理) picks its own base tier — the client
  // sends the custom_role_key, and we look up (not trust) its base_role, so
  // there's no way to smuggle a higher tier through the `role` field.
  let role: UserRole = (body.role ?? 'technician') as UserRole
  let customRoleKey: string | null = null
  if (body.custom_role_key) {
    const { data: cr } = await admin
      .from('custom_roles')
      .select('key, base_role')
      .eq('key', body.custom_role_key)
      .maybeSingle()
    if (!cr) return NextResponse.json({ error: '角色不存在' }, { status: 400 })
    role = cr.base_role as UserRole
    customRoleKey = cr.key
  }

  // Login name (= the assigned full name) is the credential; the email is a
  // synthetic value derived from it. An explicit email is still honored if sent.
  const loginName = body.email?.trim() || full_name || ''
  if (!loginName || !password) {
    return NextResponse.json({ error: '登入名稱與密碼必填' }, { status: 400 })
  }
  if (!isValidLoginName(loginName)) {
    return NextResponse.json({ error: '登入名稱請使用英文或數字' }, { status: 400 })
  }
  const email = accountNameToEmail(loginName)
  if (password.length < 6) {
    return NextResponse.json({ error: '密碼至少 6 碼' }, { status: 400 })
  }
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: '角色不正確' }, { status: 400 })
  }

  // factory_id may be null = "cross-factory" (not bound to one factory).
  const resolvedFactoryId = factory_id

  // Create auth user (auto-confirm so they can log in immediately)
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  })
  if (createErr || !created.user) {
    return NextResponse.json({ error: createErr?.message || '建立帳號失敗' }, { status: 400 })
  }

  // Ensure profile reflects the admin-chosen role / factory.
  // (The on_auth_user_created trigger may have created a default profile.)
  const { error: upsertErr } = await admin
    .from('profiles')
    .upsert({
      id: created.user.id,
      factory_id: resolvedFactoryId,
      full_name,
      role,
      custom_role_key: customRoleKey,
      is_active: true,
      is_shared_device: !!body.is_shared_device,
    }, { onConflict: 'id' })

  if (upsertErr) {
    // Roll back the auth user so we don't leave an orphan
    await admin.auth.admin.deleteUser(created.user.id)
    return NextResponse.json({ error: upsertErr.message }, { status: 400 })
  }

  // Optional: register a personal Telegram chat_id in the same step, so admins
  // don't have to separately visit Settings → Telegram right after creating an
  // account. factory_id may be NULL for cross-factory accounts — personal
  // nudges (notifyAssignees) look up by profile_id, never by factory, so the
  // registration works identically either way.
  // Best-effort: the account itself is already created and must not be rolled
  // back over a Telegram hiccup (e.g. chat_id already used by someone else).
  let telegramLinkError: string | null = null
  const chatIdRaw = body.telegram_chat_id
  if (chatIdRaw !== undefined && chatIdRaw !== null && String(chatIdRaw).trim() !== '') {
    const { error: tgErr } = await admin.from('telegram_users').insert({
      factory_id: resolvedFactoryId,
      profile_id: created.user.id,
      telegram_chat_id: Number(chatIdRaw),
    })
    if (tgErr) {
      telegramLinkError = tgErr.code === '23505'
        ? '此 Telegram Chat ID 已被其他帳號使用'
        : tgErr.message
    }
  }

  return NextResponse.json({ id: created.user.id, telegramLinkError }, { status: 201 })
}
