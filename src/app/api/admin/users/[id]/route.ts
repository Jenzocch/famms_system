import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { accountNameToEmail, isValidLoginName } from '@/lib/login-name'
import type { UserRole } from '@/types'

const VALID_ROLES: UserRole[] = ['technician', 'supervisor', 'manager', 'director', 'admin']

// PATCH — update profile fields and/or reset password (admin only)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: '無權限' }, { status: guard.status })

  const { id } = await params

  let body: {
    full_name?: string
    role?: string
    factory_id?: string | null
    is_active?: boolean
    password?: string
    telegram_chat_id?: string | number
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '無效的請求' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Optional password reset
  if (body.password !== undefined && body.password !== '') {
    if (body.password.length < 6) {
      return NextResponse.json({ error: '密碼至少 6 碼' }, { status: 400 })
    }
    const { error } = await admin.auth.admin.updateUserById(id, { password: body.password })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // The login name IS the full name, so keep the synthetic auth email in sync
  // when the name changes (otherwise the login name would drift from display).
  if (body.full_name !== undefined && body.full_name.trim()) {
    if (!isValidLoginName(body.full_name)) {
      return NextResponse.json({ error: '登入名稱請使用英文或數字' }, { status: 400 })
    }
    const { error } = await admin.auth.admin.updateUserById(id, { email: accountNameToEmail(body.full_name) })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Build profile update from provided fields only
  const update: Record<string, unknown> = {}
  if (body.full_name !== undefined) update.full_name = body.full_name.trim() || null
  // factory_id present (incl. null) = set it; null means cross-factory.
  if ('factory_id' in body) update.factory_id = body.factory_id || null
  if (body.is_active !== undefined) update.is_active = body.is_active
  if (body.role !== undefined) {
    if (!VALID_ROLES.includes(body.role as UserRole)) {
      return NextResponse.json({ error: '角色不正確' }, { status: 400 })
    }
    update.role = body.role
  }

  if (Object.keys(update).length > 0) {
    update.updated_at = new Date().toISOString()
    const { error } = await admin.from('profiles').update(update).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Optional: set/update the personal Telegram chat_id from the same edit
  // form. An empty value is a no-op (never auto-removes — deletion stays a
  // deliberate action in Settings → Telegram). Requires a single factory
  // (telegram_users.factory_id is NOT NULL): use factory_id from this same
  // request if provided, else look up the account's current one.
  let telegramLinkError: string | null = null
  const chatIdRaw = body.telegram_chat_id
  if (chatIdRaw !== undefined && chatIdRaw !== null && String(chatIdRaw).trim() !== '') {
    let resolvedFactoryId = 'factory_id' in body ? (body.factory_id || null) : undefined
    if (resolvedFactoryId === undefined) {
      const { data: prof } = await admin.from('profiles').select('factory_id').eq('id', id).single()
      resolvedFactoryId = prof?.factory_id ?? null
    }
    if (!resolvedFactoryId) {
      telegramLinkError = '跨廠帳號無法在此設定 Telegram，請至設定頁的 Telegram 個人通知新增'
    } else {
      const { error: tgErr } = await admin.from('telegram_users').upsert({
        factory_id: resolvedFactoryId,
        profile_id: id,
        telegram_chat_id: Number(chatIdRaw),
      }, { onConflict: 'factory_id,profile_id' })
      if (tgErr) {
        telegramLinkError = tgErr.code === '23505'
          ? '此 Telegram Chat ID 已被其他帳號使用'
          : tgErr.message
      }
    }
  }

  return NextResponse.json({ ok: true, telegramLinkError })
}

// DELETE — remove a user entirely (admin only)
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: '無權限' }, { status: guard.status })

  const { id } = await params

  // Prevent admins from deleting their own account
  if (id === guard.user.id) {
    return NextResponse.json({ error: '無法刪除自己的帳號' }, { status: 400 })
  }

  const admin = createAdminClient()
  // Deleting the auth user cascades to profiles (FK ON DELETE CASCADE)
  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ ok: true })
}
