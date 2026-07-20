'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { Loader2, Trash2, Plus, Pencil, CircleCheck, CircleX, KeyRound, Send, Tablet } from 'lucide-react'
import { ROLE_ZH } from '@/lib/incident-display'
import type { UserRole } from '@/types'
import type { CustomRole } from '@/lib/roles'
import { customRoleLabel } from '@/lib/roles'
import { useI18n } from '@/lib/i18n'

interface Factory { id: string; name: string }
interface ManagedUser {
  id: string
  email: string
  full_name: string
  role: UserRole
  custom_role_key: string | null
  factory_id: string | null
  is_active: boolean
  is_shared_device: boolean
  created_at: string
  telegram_chat_id: number | null
}

// Manager / director were removed from the assignable set — technician,
// supervisor (the single elevated operational role), and admin are the base
// tiers you can assign directly. Legacy accounts that still carry
// manager/director keep working (label maps below still cover them); they
// just can't be picked for new/edited users. Anything else — QC, 帳號管理員,
// 工廠管理員 and whatever gets added later — is a custom role (Settings →
// 角色管理), fetched below. 'admin' is filtered out client-side (see
// canAssignAdmin below) for anyone who isn't themselves a true system admin —
// the API additionally enforces this server-side, since a client-side-only
// guard is bypassable via a direct request.
const ALL_BASE_ROLES: UserRole[] = ['technician', 'supervisor', 'admin']

// A select needs one flat value space; prefix custom role keys so they can't
// collide with a base UserRole string.
const CUSTOM_PREFIX = 'custom:'

// Sentinel for "not bound to a single factory" (cross-factory). Base UI Select
// can't use an empty-string value, so we map this <-> null factory_id.
const ALL_FACTORIES = '__all__'

const ROLE_BADGE: Record<UserRole, string> = {
  technician: 'bg-gray-100 text-gray-700',
  supervisor: 'bg-blue-100 text-blue-700',
  manager: 'bg-purple-100 text-purple-700',
  director: 'bg-amber-100 text-amber-700',
  admin: 'bg-red-100 text-red-700',
}
const CUSTOM_ROLE_BADGE = 'bg-teal-100 text-teal-700'

export default function UserManager({ currentUserId, canAssignAdmin = false }: { currentUserId: string; canAssignAdmin?: boolean }) {
  const { t, locale } = useI18n()
  const supabase = createClient()
  const roleLabel = (r: UserRole) => t(`roles.${r}`, ROLE_ZH[r])
  // Only a true system admin may hand out (or keep viewing as an option) the
  // admin tier — an Account Admin viewing this form never sees it, matching
  // the server-side privilege-escalation guard in the API routes.
  const BASE_ROLES: UserRole[] = canAssignAdmin ? ALL_BASE_ROLES : ALL_BASE_ROLES.filter(r => r !== 'admin')
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [factories, setFactories] = useState<Factory[]>([])
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  // Whether the account being edited logs in with a real email (not the
  // synthetic name@famms.local scheme) — changes this field's meaning from
  // "this IS the login" to "display name only, login stays the email".
  const [editingRealEmail, setEditingRealEmail] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  // Edit-mode only, synthetic accounts only: the login identifier, decoupled
  // from the display name (renaming display used to silently rename the login).
  const [loginName, setLoginName] = useState('')
  // Either a plain UserRole ('technician'…) or `custom:<key>`.
  const [roleSelection, setRoleSelection] = useState<string>('technician')
  const [factoryId, setFactoryId] = useState('')
  const [telegramChatId, setTelegramChatId] = useState('')
  // Shared device (e.g. a tablet passed between technicians) — the report
  // form leaves 回報人 blank instead of auto-filling this account's name.
  const [isSharedDevice, setIsSharedDevice] = useState(false)

  useEffect(() => {
    supabase.from('factories').select('id, name').order('name').then(({ data }) => {
      setFactories(data ?? [])
    })
    supabase.from('custom_roles').select('*').order('created_at').then(({ data }) => {
      setCustomRoles((data ?? []) as CustomRole[])
    })
    loadUsers()
    // Mount-only load. `loadUsers` is intentionally omitted: it's a fresh
    // function reference every render (closes over the unstable `supabase`
    // client), so adding it would re-run this effect on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const roleOptions: { value: string; label: string }[] = [
    ...BASE_ROLES.map(r => ({ value: r, label: roleLabel(r) })),
    ...customRoles.map(cr => ({ value: `${CUSTOM_PREFIX}${cr.key}`, label: customRoleLabel(cr, locale) })),
  ]

  function displayRole(u: ManagedUser): { label: string; badgeClass: string } {
    if (u.custom_role_key) {
      const cr = customRoles.find(c => c.key === u.custom_role_key)
      if (cr) return { label: customRoleLabel(cr, locale), badgeClass: CUSTOM_ROLE_BADGE }
    }
    return { label: roleLabel(u.role), badgeClass: ROLE_BADGE[u.role] }
  }

  async function loadUsers() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/users')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || t('settings.loadFailed'))
      setUsers(json.users ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.loadUsersFailed'))
    } finally {
      setLoading(false)
    }
  }

  function startAdd() {
    setEditingId(null)
    setEditingRealEmail(null)
    setPassword('')
    setFullName('')
    setRoleSelection('technician')
    setFactoryId(factories[0]?.id ?? '')
    setTelegramChatId('')
    setIsSharedDevice(false)
    setShowForm(true)
  }

  function startEdit(u: ManagedUser) {
    setEditingId(u.id)
    const synthetic = u.email.endsWith('@famms.local')
    setEditingRealEmail(synthetic ? null : u.email)
    setLoginName(synthetic ? u.email.split('@')[0] : '')
    setPassword('')
    setFullName(u.full_name)
    setRoleSelection(u.custom_role_key ? `${CUSTOM_PREFIX}${u.custom_role_key}` : u.role)
    setFactoryId(u.factory_id ?? '')
    setTelegramChatId(u.telegram_chat_id != null ? String(u.telegram_chat_id) : '')
    setIsSharedDevice(u.is_shared_device)
    setShowForm(true)
  }

  function resetForm() {
    setShowForm(false)
    setEditingId(null)
    setEditingRealEmail(null)
    setLoginName('')
    setPassword('')
    setTelegramChatId('')
    setIsSharedDevice(false)
  }

  // Decode roleSelection into the payload fields the API expects.
  function roleFields(): { role?: UserRole; custom_role_key: string | null } {
    if (roleSelection.startsWith(CUSTOM_PREFIX)) {
      return { custom_role_key: roleSelection.slice(CUSTOM_PREFIX.length) }
    }
    return { role: roleSelection as UserRole, custom_role_key: null }
  }

  async function submit() {
    if (!editingId && (!fullName.trim() || !password)) {
      toast.error(t('settings.namePwdRequired'))
      return
    }
    setSubmitting(true)
    try {
      if (editingId) {
        const res = await fetch(`/api/admin/users/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            full_name: fullName,
            // Synthetic accounts only: the login identifier, edited separately
            // from the display name.
            ...(editingRealEmail === null && loginName.trim() ? { login_name: loginName.trim() } : {}),
            ...roleFields(),
            factory_id: factoryId || null,
            telegram_chat_id: telegramChatId.trim() || undefined,
            is_shared_device: isSharedDevice,
            ...(password ? { password } : {}),
          }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || t('settings.updateFailed'))
        toast.success(password ? t('settings.updatedWithPwd') : t('settings.updated'))
        if (json.telegramLinkError) toast.warning(json.telegramLinkError)
      } else {
        const res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            password, full_name: fullName, ...roleFields(), factory_id: factoryId || null,
            telegram_chat_id: telegramChatId.trim() || undefined,
            is_shared_device: isSharedDevice,
          }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || t('settings.createFailed'))
        toast.success(t('settings.userCreated'))
        if (json.telegramLinkError) toast.warning(json.telegramLinkError)
      }
      resetForm()
      loadUsers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.operationFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(u: ManagedUser) {
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !u.is_active }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || t('settings.updateFailed'))
      toast.success(u.is_active ? t('settings.deactivated') : t('settings.activated'))
      loadUsers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.operationFailed'))
    }
  }

  async function remove(u: ManagedUser) {
    if (u.id === currentUserId) { toast.error(t('settings.cannotDeleteSelf')); return }
    if (!confirm(t('settings.confirmDeleteUser').replace('{email}', u.email))) return
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || t('settings.deleteFailed'))
      toast.success(t('settings.userDeleted'))
      loadUsers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.deleteFailed'))
    }
  }

  const factoryName = (id: string | null) => factories.find(f => f.id === id)?.name ?? '—'

  if (loading) return <div className="text-center text-gray-500 text-sm py-4">{t('settings.loading')}</div>

  return (
    <div className="space-y-4">
      {!showForm && (
        <Button onClick={startAdd} className="gap-2 w-full">
          <Plus className="w-4 h-4" /> {t('settings.addUser')}
        </Button>
      )}

      {showForm && (
        <div className="bg-gray-50 p-4 rounded-lg space-y-3">
          <p className="text-sm font-medium text-gray-700">
            {editingId ? t('settings.editUser') : t('settings.addUser')}
          </p>

          <div>
            {/* Create mode: one field — the name IS the login. Edit mode:
                login and display name are separate, so renaming how someone
                appears can never silently change how they sign in (that bite:
                a display rename locked the main admin out of their login). */}
            {editingId && editingRealEmail === null && (
              <div className="mb-3">
                <Label>{t('settings.loginAccount', '登入帳號')}</Label>
                <Input
                  value={loginName}
                  onChange={e => setLoginName(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="mt-1 font-mono"
                />
                <p className="text-xs text-gray-400 mt-1">{t('settings.loginAccountHint', '登入時輸入的帳號（英文或數字）。改這裡才會改登入方式。')}</p>
              </div>
            )}
            <Label>{editingId ? t('settings.displayNameOnly', '顯示名稱') : t('settings.loginName')}</Label>
            <Input
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder={t('settings.loginNamePlaceholder')}
              autoCapitalize="none"
              autoCorrect="off"
              className="mt-1"
            />
            {editingRealEmail ? (
              <p className="text-xs text-gray-400 mt-1">
                {t('settings.displayNameOnlyHint', '此帳號用 email 登入（{email}），這裡只改顯示名稱，不影響登入方式。').replace('{email}', editingRealEmail)}
              </p>
            ) : editingId ? (
              <p className="text-xs text-gray-400 mt-1">{t('settings.displayNameHint', '畫面上顯示的名字，不影響登入。')}</p>
            ) : (
              <p className="text-xs text-gray-400 mt-1">{t('settings.loginNameHint')}</p>
            )}
          </div>

          <div>
            <Label className="flex items-center gap-1">
              <KeyRound className="w-3.5 h-3.5" />
              {editingId ? t('settings.resetPassword') : t('settings.password')}
            </Label>
            <Input
              type="text"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={editingId ? t('settings.pwdKeepPlaceholder') : t('settings.pwdMinPlaceholder')}
              className="mt-1 font-mono"
            />
            {editingId && (
              <p className="text-xs text-gray-400 mt-1">{t('settings.pwdResetHint')}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>{t('settings.role')}</Label>
              <Select
                value={roleSelection}
                onValueChange={(v) => setRoleSelection(v ?? 'technician')}
                items={Object.fromEntries(roleOptions.map(o => [o.value, o.label]))}
              >
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roleOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t('settings.factory')}</Label>
              <Select
                value={factoryId || ALL_FACTORIES}
                onValueChange={(v) => setFactoryId(v === ALL_FACTORIES ? '' : (v ?? ''))}
                items={{ [ALL_FACTORIES]: t('settings.allFactories', '全部工廠（跨廠）'), ...Object.fromEntries(factories.map(f => [f.id, f.name])) }}
              >
                <SelectTrigger className="mt-1"><SelectValue placeholder={t('settings.selectFactory')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FACTORIES}>{t('settings.allFactories', '全部工廠（跨廠）')}</SelectItem>
                  {factories.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="flex items-center gap-1">
              <Send className="w-3.5 h-3.5" />
              {t('settings.telegramChatId', 'Telegram Chat ID（選填）')}
            </Label>
            <Input
              value={telegramChatId}
              onChange={e => setTelegramChatId(e.target.value)}
              placeholder="5003966994"
              className="mt-1 font-mono"
            />
            <p className="text-xs text-gray-400 mt-1">
              {t('settings.telegramChatIdHint', '員工在 Telegram 私訊 bot 傳送 /start 取得。留空則不設定。')}
            </p>
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isSharedDevice}
              onChange={e => setIsSharedDevice(e.target.checked)}
              className="mt-0.5 w-4 h-4 shrink-0"
            />
            <span>
              <span className="text-sm font-medium flex items-center gap-1">
                <Tablet className="w-3.5 h-3.5" /> {t('settings.sharedDevice', '共用裝置帳號（例如平板）')}
              </span>
              <span className="text-xs text-gray-400 block mt-0.5">
                {t('settings.sharedDeviceHint', '多人共用同一台裝置登入時勾選 — 回報問題時「回報人」欄位會留空，強制手動選擇實際回報的人，不會自動帶入這個帳號的名字。')}
              </span>
            </span>
          </label>

          <div className="flex gap-2">
            <Button onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingId ? t('settings.update') : t('settings.createBtn')}
            </Button>
            <Button variant="outline" onClick={resetForm}>{t('settings.cancel')}</Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {users.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">{t('settings.noUsers')}</p>
        ) : (
          users.map(u => {
            const { label: roleText, badgeClass } = displayRole(u)
            // An Account Admin (canAssignAdmin === false) can't edit, deactivate,
            // or delete a true system admin's account — mirrors the server-side
            // privilege-escalation guards in the API routes exactly, so the UI
            // never dangles a button that would just 403.
            const isProtectedAdmin = u.role === 'admin' && !canAssignAdmin
            return (
            <div key={u.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 border rounded-lg bg-white gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm truncate">{u.full_name || u.email}</p>
                <div className="flex items-center gap-1 flex-wrap mt-1">
                  <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded-full font-medium ${badgeClass}`}>
                    {roleText}
                  </span>
                  {!u.is_active && (
                    <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-500">{t('settings.deactivated')}</span>
                  )}
                  {u.is_shared_device && (
                    <span className="shrink-0 inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                      <Tablet className="w-3 h-3" /> {t('settings.sharedDeviceBadge', '共用裝置')}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 truncate mt-1">
                  {t('settings.loginNameShort')}: {u.email.endsWith('@famms.local') ? u.email.split('@')[0] : u.email}
                </p>
                <p className="text-xs text-gray-400">{factoryName(u.factory_id)}</p>
              </div>
              <div className="flex gap-1 shrink-0 self-end sm:self-auto">
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => toggleActive(u)}
                  disabled={isProtectedAdmin}
                  title={isProtectedAdmin ? t('settings.systemAdminProtected', '無權限操作系統管理員帳號') : (u.is_active ? t('settings.deactivate') : t('settings.activate'))}
                  className={`h-10 w-10 ${u.is_active ? 'text-green-600' : 'text-red-500'}`}
                >
                  {u.is_active ? <CircleCheck className="w-4 h-4" /> : <CircleX className="w-4 h-4" />}
                </Button>
                <Button
                  size="icon" className="h-10 w-10" variant="outline"
                  onClick={() => startEdit(u)}
                  disabled={isProtectedAdmin}
                  title={isProtectedAdmin ? t('settings.systemAdminProtected', '無權限操作系統管理員帳號') : undefined}
                >
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button
                  size="icon" className="h-10 w-10"
                  variant="outline"
                  onClick={() => remove(u)}
                  disabled={u.id === currentUserId || isProtectedAdmin}
                  title={isProtectedAdmin ? t('settings.systemAdminProtected', '無權限操作系統管理員帳號') : undefined}
                >
                  <Trash2 className={`w-4 h-4 ${u.id === currentUserId || isProtectedAdmin ? 'text-gray-300' : 'text-red-600'}`} />
                </Button>
              </div>
            </div>
            )
          })
        )}
      </div>
    </div>
  )
}
