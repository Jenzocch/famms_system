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
import { Loader2, Trash2, Plus, Pencil, ShieldAlert } from 'lucide-react'
import type { UserRole } from '@/types'
import {
  CAPABILITY_KEYS, CAPABILITY_LABELS, CUSTOM_ROLE_BASE_OPTIONS,
  type CustomRole, type CapabilityKey,
} from '@/lib/roles'
import { useI18n } from '@/lib/i18n'

const BASE_ROLE_LABEL: Record<UserRole, string> = {
  technician: '一般員工 (technician)',
  supervisor: '主管 (supervisor)',
  manager: '經理 (manager)',
  director: '廠長 (director)',
  admin: '系統管理員 (admin)',
}

type CapMap = Record<CapabilityKey, boolean>

// Admin-managed roles, without a code change per role. A role here is an
// overlay: it inherits one of the 3 safe base tiers for everything the
// database enforces (RCA/close/due-date/manage-*), and may additionally be
// granted the small fixed set of soft capabilities in lib/roles.ts. See
// migration_custom_roles.sql for the full design rationale.
export default function RoleManager() {
  const { t } = useI18n()
  const supabase = createClient()
  const [roles, setRoles] = useState<CustomRole[]>([])
  const [capsByRole, setCapsByRole] = useState<Record<string, CapMap>>({})
  const [userCounts, setUserCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [labelZh, setLabelZh] = useState('')
  const [labelEn, setLabelEn] = useState('')
  const [labelId, setLabelId] = useState('')
  const [baseRole, setBaseRole] = useState<UserRole>('technician')
  const [caps, setCaps] = useState<CapMap>({ dashboard: false, boardFull: false, viewMachines: true, manageUsers: false })

  // Mount-only load. `load` is intentionally omitted: it's a fresh function
  // reference every render (closes over the unstable `supabase` client), so
  // adding it would re-run this effect on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [{ data: roleRows }, { data: capRows }, { data: profileRows }] = await Promise.all([
        supabase.from('custom_roles').select('*').order('created_at'),
        supabase.from('role_capabilities').select('role_key, capability, allowed'),
        supabase.from('profiles').select('custom_role_key').not('custom_role_key', 'is', null),
      ])
      setRoles((roleRows ?? []) as CustomRole[])
      const byRole: Record<string, CapMap> = {}
      for (const r of (roleRows ?? [])) byRole[r.key] = { dashboard: false, boardFull: false, viewMachines: true, manageUsers: false }
      for (const c of (capRows ?? [])) {
        if (!byRole[c.role_key]) byRole[c.role_key] = { dashboard: false, boardFull: false, viewMachines: true, manageUsers: false }
        if ((CAPABILITY_KEYS as readonly string[]).includes(c.capability)) {
          byRole[c.role_key][c.capability as CapabilityKey] = c.allowed
        }
      }
      setCapsByRole(byRole)
      const counts: Record<string, number> = {}
      for (const p of (profileRows ?? [])) {
        const k = p.custom_role_key as string
        counts[k] = (counts[k] ?? 0) + 1
      }
      setUserCounts(counts)
    } catch {
      toast.error(t('settings.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  function startAdd() {
    setEditingKey(null)
    setKey('')
    setLabelZh('')
    setLabelEn('')
    setLabelId('')
    setBaseRole('technician')
    setCaps({ dashboard: false, boardFull: false, viewMachines: true, manageUsers: false })
    setShowForm(true)
  }

  function startEdit(r: CustomRole) {
    setEditingKey(r.key)
    setKey(r.key)
    setLabelZh(r.label_zh)
    setLabelEn(r.label_en)
    setLabelId(r.label_id)
    setBaseRole(r.base_role)
    setCaps({ ...(capsByRole[r.key] ?? { dashboard: false, boardFull: false, viewMachines: true, manageUsers: false }) })
    setShowForm(true)
  }

  function resetForm() {
    setShowForm(false)
    setEditingKey(null)
  }

  async function submit() {
    if (!editingKey && !key.trim()) { toast.error(t('settings.roleKeyRequired', '請輸入角色代碼')); return }
    if (!labelZh.trim() || !labelEn.trim() || !labelId.trim()) {
      toast.error(t('settings.roleLabelsRequired', '三種語言名稱都要填')); return
    }
    const normalizedKey = editingKey ?? key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
    setSubmitting(true)
    try {
      const wasBaseRole = editingKey ? roles.find(r => r.key === editingKey)?.base_role : null

      const { error: upsertErr } = await supabase.from('custom_roles').upsert({
        key: normalizedKey,
        label_zh: labelZh.trim(),
        label_en: labelEn.trim(),
        label_id: labelId.trim(),
        base_role: baseRole,
      }, { onConflict: 'key' })
      if (upsertErr) throw upsertErr

      // Capability rows: upsert each of the fixed keys (never freeform).
      const capRows = CAPABILITY_KEYS.map(k => ({ role_key: normalizedKey, capability: k, allowed: caps[k] }))
      const { error: capErr } = await supabase.from('role_capabilities').upsert(capRows, { onConflict: 'role_key,capability' })
      if (capErr) throw capErr

      // If an existing role's underlying DB tier changed, every account
      // carrying this custom_role_key must move to the new tier too —
      // otherwise their profiles.role (the actual DB-enforced value) would
      // silently drift from what the role definition now says.
      if (editingKey && wasBaseRole && wasBaseRole !== baseRole) {
        const { error: cascadeErr } = await supabase
          .from('profiles')
          .update({ role: baseRole })
          .eq('custom_role_key', normalizedKey)
        if (cascadeErr) throw cascadeErr
      }

      toast.success(editingKey ? t('settings.updated') : t('settings.roleCreated', '角色已建立'))
      resetForm()
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.operationFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(r: CustomRole) {
    const n = userCounts[r.key] ?? 0
    const warn = n > 0
      ? t('settings.roleDeleteWithUsers', '有 {n} 個帳號正在使用「{name}」，刪除後他們會變回原本的基礎權限（不會被停用）。確定刪除？').replace('{n}', String(n)).replace('{name}', r.label_zh)
      : t('settings.confirmDeleteRole', '確定刪除此角色？')
    if (!confirm(warn)) return
    try {
      const { error } = await supabase.from('custom_roles').delete().eq('key', r.key)
      if (error) throw error
      toast.success(t('settings.deleted'))
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.deleteFailed'))
    }
  }

  if (loading) return <div className="text-center text-gray-500 text-sm py-4">{t('settings.loading')}</div>

  return (
    <div className="space-y-4">
      {!showForm && (
        <Button onClick={startAdd} className="gap-2 w-full">
          <Plus className="w-4 h-4" /> {t('settings.addRole', '新增角色')}
        </Button>
      )}

      {showForm && (
        <div className="bg-gray-50 p-4 rounded-lg space-y-3">
          <p className="text-sm font-medium text-gray-700">
            {editingKey ? t('settings.editRole', '編輯角色') : t('settings.addRole', '新增角色')}
          </p>

          {!editingKey && (
            <div>
              <Label>{t('settings.roleKey', '角色代碼（英文，之後不能改）')}</Label>
              <Input
                value={key}
                onChange={e => setKey(e.target.value)}
                placeholder="warehouse_staff"
                autoCapitalize="none"
                autoCorrect="off"
                className="mt-1 font-mono"
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <Label>{t('settings.roleLabelZh', '名稱（中文）')}</Label>
              <Input value={labelZh} onChange={e => setLabelZh(e.target.value)} placeholder="倉管" className="mt-1" />
            </div>
            <div>
              <Label>{t('settings.roleLabelEn', '名稱（英文）')}</Label>
              <Input value={labelEn} onChange={e => setLabelEn(e.target.value)} placeholder="Warehouse" className="mt-1" />
            </div>
            <div>
              <Label>{t('settings.roleLabelId', '名稱（印尼文）')}</Label>
              <Input value={labelId} onChange={e => setLabelId(e.target.value)} placeholder="Gudang" className="mt-1" />
            </div>
          </div>

          <div>
            <Label>{t('settings.roleBaseTier', '底層權限級別')}</Label>
            <Select value={baseRole} onValueChange={(v) => setBaseRole((v ?? 'technician') as UserRole)} items={Object.fromEntries(CUSTOM_ROLE_BASE_OPTIONS.map(r => [r, BASE_ROLE_LABEL[r]]))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CUSTOM_ROLE_BASE_OPTIONS.map(r => <SelectItem key={r} value={r}>{BASE_ROLE_LABEL[r]}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-400 mt-1">
              {t('settings.roleBaseTierHint', '這決定資料庫實際的安全權限（結案/RCA/管理設備等）— 沿用哪一個基礎角色的規則。改動會套用到所有使用此角色的帳號。')}
            </p>
          </div>

          <div>
            <Label>{t('settings.roleCapabilities', '額外可見度')}</Label>
            <div className="mt-1 space-y-1.5">
              {CAPABILITY_KEYS.map(ck => (
                <label key={ck} className="flex items-center gap-2 text-sm text-gray-700 bg-white rounded-lg border border-gray-200 px-3 py-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={caps[ck]}
                    onChange={e => setCaps(prev => ({ ...prev, [ck]: e.target.checked }))}
                    className="w-4 h-4"
                  />
                  {CAPABILITY_LABELS[ck].zh}
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingKey ? t('settings.update') : t('settings.createBtn')}
            </Button>
            <Button variant="outline" onClick={resetForm}>{t('settings.cancel')}</Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {roles.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">{t('settings.noCustomRoles', '尚未新增任何角色')}</p>
        ) : (
          roles.map(r => (
            <div key={r.key} className="flex items-center justify-between p-3 border rounded-lg bg-white gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm">{r.label_zh}</p>
                  <span className="text-xs text-gray-400 font-mono">{r.key}</span>
                  {r.is_system && (
                    <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{t('settings.systemRole', '內建')}</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {t('settings.roleBaseTierShort', '底層')}: {BASE_ROLE_LABEL[r.base_role]}
                  {' · '}
                  {CAPABILITY_KEYS.filter(ck => capsByRole[r.key]?.[ck]).map(ck => CAPABILITY_LABELS[ck].zh).join('、') || t('settings.noExtraCapabilities', '無額外可見度')}
                </p>
                {(userCounts[r.key] ?? 0) > 0 && (
                  <p className="text-xs text-gray-400 mt-0.5">{userCounts[r.key]} {t('settings.accountsUsingRole', '個帳號使用中')}</p>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="icon" className="h-10 w-10" variant="outline" onClick={() => startEdit(r)}>
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button
                  size="icon" className="h-10 w-10"
                  variant="outline"
                  onClick={() => remove(r)}
                  disabled={r.is_system}
                  title={r.is_system ? t('settings.systemRoleCannotDelete', '內建角色無法刪除') : undefined}
                >
                  {r.is_system
                    ? <ShieldAlert className="w-4 h-4 text-gray-300" />
                    : <Trash2 className="w-4 h-4 text-red-600" />}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
