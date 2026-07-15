import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { accountNameToEmail, isValidLoginName, SYNTHETIC_EMAIL_DOMAIN } from '@/lib/login-name'
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
    login_name?: string
    role?: string
    custom_role_key?: string | null
    factory_id?: string | null
    is_active?: boolean
    password?: string
    telegram_chat_id?: string | number
    is_shared_device?: boolean
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

  // Login identifier is edited EXPLICITLY via login_name — full_name is now
  // display-only and never touches the auth email. (History: full_name used
  // to sync the email, so renaming how the main admin appeared silently
  // renamed their login and locked them out.) Only synthetic-login accounts
  // (name@famms.local) can be renamed this way; a real-email account's
  // credential is never overwritten.
  if (body.login_name !== undefined && body.login_name.trim()) {
    if (!isValidLoginName(body.login_name)) {
      return NextResponse.json({ error: '登入名稱請使用英文或數字' }, { status: 400 })
    }
    const { data: existing } = await admin.auth.admin.getUserById(id)
    const currentEmail = existing?.user?.email ?? ''
    if (currentEmail.endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`)) {
      const nextEmail = accountNameToEmail(body.login_name)
      if (nextEmail !== currentEmail) {
        const { error } = await admin.auth.admin.updateUserById(id, { email: nextEmail })
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      }
    }
  }

  // Build profile update from provided fields only
  const update: Record<string, unknown> = {}
  if (body.full_name !== undefined) update.full_name = body.full_name.trim() || null
  // factory_id present (incl. null) = set it; null means cross-factory.
  if ('factory_id' in body) update.factory_id = body.factory_id || null
  if (body.is_active !== undefined) update.is_active = body.is_active
  if (body.is_shared_device !== undefined) update.is_shared_device = body.is_shared_device
  // custom_role_key present (incl. explicit null = "revert to a base role")
  // wins over `role`: same look-up-don't-trust pattern as account creation —
  // the tier comes from the DB row, never straight from the client.
  if ('custom_role_key' in body) {
    if (body.custom_role_key) {
      const { data: cr } = await admin
        .from('custom_roles')
        .select('key, base_role')
        .eq('key', body.custom_role_key)
        .maybeSingle()
      if (!cr) return NextResponse.json({ error: '角色不存在' }, { status: 400 })
      update.custom_role_key = cr.key
      update.role = cr.base_role
    } else {
      update.custom_role_key = null
      if (body.role !== undefined) {
        if (!VALID_ROLES.includes(body.role as UserRole)) {
          return NextResponse.json({ error: '角色不正確' }, { status: 400 })
        }
        update.role = body.role
      }
    }
  } else if (body.role !== undefined) {
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
  // deliberate action in Settings → Telegram). factory_id may be NULL for
  // cross-factory accounts — personal nudges (notifyAssignees) look up by
  // profile_id, never by factory. Update-then-insert instead of upsert: the
  // NULL-factory uniqueness lives in a partial index, which PostgREST's
  // onConflict can't target.
  let telegramLinkError: string | null = null
  const chatIdRaw = body.telegram_chat_id
  if (chatIdRaw !== undefined && chatIdRaw !== null && String(chatIdRaw).trim() !== '') {
    let resolvedFactoryId = 'factory_id' in body ? (body.factory_id || null) : undefined
    if (resolvedFactoryId === undefined) {
      const { data: prof } = await admin.from('profiles').select('factory_id').eq('id', id).single()
      resolvedFactoryId = prof?.factory_id ?? null
    }
    const { data: existingTg } = await admin
      .from('telegram_users')
      .select('id')
      .eq('profile_id', id)
      .limit(1)
      .maybeSingle()
    const { error: tgErr } = existingTg
      ? await admin.from('telegram_users')
          .update({ telegram_chat_id: Number(chatIdRaw), factory_id: resolvedFactoryId })
          .eq('id', existingTg.id)
      : await admin.from('telegram_users').insert({
          factory_id: resolvedFactoryId,
          profile_id: id,
          telegram_chat_id: Number(chatIdRaw),
        })
    if (tgErr) {
      telegramLinkError = tgErr.code === '23505'
        ? '此 Telegram Chat ID 已被其他帳號使用'
        : tgErr.message
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
