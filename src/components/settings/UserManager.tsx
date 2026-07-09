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
import { Loader2, Trash2, Plus, Pencil, ShieldCheck, KeyRound, Send } from 'lucide-react'
import { ROLE_ZH } from '@/lib/incident-display'
import type { UserRole } from '@/types'
import { useI18n } from '@/lib/i18n'

interface Factory { id: string; name: string }
interface ManagedUser {
  id: string
  email: string
  full_name: string
  role: UserRole
  factory_id: string | null
  is_active: boolean
  created_at: string
  telegram_chat_id: number | null
}

// Manager / director were removed from the assignable set — only technician,
// supervisor (the single elevated operational role) and admin remain. Legacy
// accounts that still carry manager/director keep working (label maps below
// still cover them); they just can't be picked for new/edited users.
const ROLES: UserRole[] = ['technician', 'supervisor', 'admin']

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

export default function UserManager({ currentUserId }: { currentUserId: string }) {
  const { t } = useI18n()
  const supabase = createClient()
  const roleLabel = (r: UserRole) => t(`roles.${r}`, ROLE_ZH[r])
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [factories, setFactories] = useState<Factory[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<UserRole>('technician')
  const [factoryId, setFactoryId] = useState('')
  const [telegramChatId, setTelegramChatId] = useState('')

  useEffect(() => {
    supabase.from('factories').select('id, name').order('name').then(({ data }) => {
      setFactories(data ?? [])
    })
    loadUsers()
  }, [])

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
    setPassword('')
    setFullName('')
    setRole('technician')
    setFactoryId(factories[0]?.id ?? '')
    setTelegramChatId('')
    setShowForm(true)
  }

  function startEdit(u: ManagedUser) {
    setEditingId(u.id)
    setPassword('')
    setFullName(u.full_name)
    setRole(u.role)
    setFactoryId(u.factory_id ?? '')
    setTelegramChatId(u.telegram_chat_id != null ? String(u.telegram_chat_id) : '')
    setShowForm(true)
  }

  function resetForm() {
    setShowForm(false)
    setEditingId(null)
    setPassword('')
    setTelegramChatId('')
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
            role,
            factory_id: factoryId || null,
            telegram_chat_id: telegramChatId.trim() || undefined,
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
            password, full_name: fullName, role, factory_id: factoryId || null,
            telegram_chat_id: telegramChatId.trim() || undefined,
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
            <Label>{t('settings.loginName')}</Label>
            <Input
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder={t('settings.loginNamePlaceholder')}
              autoCapitalize="none"
              autoCorrect="off"
              className="mt-1"
            />
            <p className="text-xs text-gray-400 mt-1">{t('settings.loginNameHint')}</p>
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
                value={role}
                onValueChange={(v) => setRole((v ?? 'technician') as UserRole)}
                items={Object.fromEntries(ROLES.map(r => [r, roleLabel(r)]))}
              >
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}
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
              disabled={!factoryId}
              className="mt-1 font-mono"
            />
            <p className="text-xs text-gray-400 mt-1">
              {factoryId
                ? t('settings.telegramChatIdHint', '員工在 Telegram 私訊 bot 傳送 /start 取得。留空則不設定。')
                : t('settings.telegramChatIdNeedsFactory', '跨廠帳號無法在此設定，請至設定頁的 Telegram 個人通知新增')}
            </p>
          </div>

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
          users.map(u => (
            <div key={u.id} className="flex items-center justify-between p-3 border rounded-lg bg-white gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm truncate">{u.full_name || u.email}</p>
                  <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded-full font-medium ${ROLE_BADGE[u.role]}`}>
                    {roleLabel(u.role)}
                  </span>
                  {!u.is_active && (
                    <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-500">{t('settings.deactivated')}</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 truncate">
                  {t('settings.loginNameShort')}: {u.email.endsWith('@famms.local') ? u.email.split('@')[0] : u.email}
                </p>
                <p className="text-xs text-gray-400">{factoryName(u.factory_id)}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => toggleActive(u)}
                  title={u.is_active ? t('settings.deactivate') : t('settings.activate')}
                  className={u.is_active ? 'text-green-600' : 'text-gray-400'}
                >
                  <ShieldCheck className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="outline" onClick={() => startEdit(u)}>
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => remove(u)}
                  disabled={u.id === currentUserId}
                >
                  <Trash2 className={`w-4 h-4 ${u.id === currentUserId ? 'text-gray-300' : 'text-red-600'}`} />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
