import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { UserRole } from '@/types'

const VALID_ROLES: UserRole[] = ['technician', 'supervisor', 'manager', 'director', 'admin']

// GET — list all users (auth email + profile fields), admin only
export async function GET() {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: '無權限' }, { status: guard.status })

  const admin = createAdminClient()

  const { data: authData, error: authErr } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 })

  const { data: profiles, error: profErr } = await admin
    .from('profiles')
    .select('id, factory_id, full_name, role, is_active')
  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 })

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]))

  const users = authData.users.map(u => {
    const p = profileMap.get(u.id)
    return {
      id: u.id,
      email: u.email ?? '',
      full_name: p?.full_name ?? '',
      role: (p?.role ?? 'technician') as UserRole,
      factory_id: p?.factory_id ?? null,
      is_active: p?.is_active ?? true,
      created_at: u.created_at,
    }
  })

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
    factory_id?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '無效的請求' }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase()
  const password = body.password ?? ''
  const full_name = body.full_name?.trim() || null
  const role = (body.role ?? 'technician') as UserRole
  const factory_id = body.factory_id || null

  if (!email || !password) {
    return NextResponse.json({ error: '帳號與密碼必填' }, { status: 400 })
  }
  if (password.length < 6) {
    return NextResponse.json({ error: '密碼至少 6 碼' }, { status: 400 })
  }
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: '角色不正確' }, { status: 400 })
  }

  const admin = createAdminClient()

  // profiles.factory_id is NOT NULL — fall back to the first factory if unset
  let resolvedFactoryId = factory_id
  if (!resolvedFactoryId) {
    const { data: firstFactory } = await admin
      .from('factories')
      .select('id')
      .order('code')
      .limit(1)
      .single()
    resolvedFactoryId = firstFactory?.id ?? null
  }
  if (!resolvedFactoryId) {
    return NextResponse.json({ error: '請先建立工廠' }, { status: 400 })
  }

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
      is_active: true,
    }, { onConflict: 'id' })

  if (upsertErr) {
    // Roll back the auth user so we don't leave an orphan
    await admin.auth.admin.deleteUser(created.user.id)
    return NextResponse.json({ error: upsertErr.message }, { status: 400 })
  }

  return NextResponse.json({ id: created.user.id }, { status: 201 })
}
