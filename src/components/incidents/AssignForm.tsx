'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Loader2, UserCheck, Check, Users, X } from 'lucide-react'
import type { UserRole } from '@/types'
import { PERMISSIONS } from '@/lib/permissions'
import { ROLE_ZH } from '@/lib/incident-display'
import { logAuditEvent } from '@/lib/audit'
import { useI18n } from '@/lib/i18n'
import { useVendors } from '@/lib/useVendors'
import { customRoleLabel, type CustomRole } from '@/lib/roles'

interface Account { id: string; full_name: string | null; role: UserRole; factory_id: string | null; custom_role_key: string | null }

export default function AssignForm({
  incidentId, assignedTo, assignedDept, assignedUserIds, dueDate, factoryId, userRole = 'technician', userName,
}: {
  incidentId: string
  assignedTo: string | null
  assignedDept: string | null
  assignedUserIds?: string[] | null
  dueDate: string | null
  factoryId?: string | null
  userRole?: UserRole
  userName?: string | null
}) {
  const router = useRouter()
  const supabase = createClient()
  const { t, locale } = useI18n()
  const canAssign = PERMISSIONS.assignIncident(userRole)
  // Assignment is open to everyone (technicians self-organize), but the due
  // date drives overdue/SLA tracking, so only supervisor+ may set or move it.
  const canEditDueDate = PERMISSIONS.editDueDate(userRole)

  const [accounts, setAccounts] = useState<Account[]>([])
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>(assignedUserIds ?? [])
  const { vendors } = useVendors()
  const [selectedVendorNames, setSelectedVendorNames] = useState<string[]>([])
  const [extraNames, setExtraNames] = useState('')
  const [accountSearch, setAccountSearch] = useState('')
  const [showAllAccounts, setShowAllAccounts] = useState(false)
  const [dept, setDept] = useState(assignedDept || '')
  const [due, setDue] = useState(dueDate || '')
  const [submitting, setSubmitting] = useState(false)

  // Load assignable accounts (active users). Profiles has RLS disabled.
  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name, role, factory_id, custom_role_key')
      .eq('is_active', true)
      .order('full_name')
      .then(({ data }) => setAccounts((data ?? []) as Account[]))
    // Custom roles (Settings → 角色管理) are how an admin defines a job
    // function like "辦公室人員" without a code change — one quick-assign
    // button per role with members lets that group be one-click assignable
    // the same way "全部技師" already is, for whatever roles get created.
    supabase.from('custom_roles').select('*').then(({ data }) => setCustomRoles((data ?? []) as CustomRole[]))
  }, [])

  // Re-sync the editable fields to the saved assignment whenever the incident's
  // stored value changes (e.g. after a save + router.refresh, or if the parent
  // reuses this component for another case). Keeps "add / swap assignee" edits
  // reflecting the real DB state instead of going stale.
  useEffect(() => {
    setSelectedIds(assignedUserIds ?? [])
    setDept(assignedDept || '')
    setDue(dueDate || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId, (assignedUserIds ?? []).join(','), assignedDept, dueDate])

  // Technicians in this incident's factory (cross-factory accounts always
  // qualify). Used by the "assign all technicians" shortcut. Excludes
  // accounts on a custom role (e.g. QC) even though they share the
  // technician DB tier — a custom role signals a distinct job function, not
  // literally "on the repair team", so a bulk-assign shouldn't sweep them in.
  const factoryTechnicians = accounts.filter(
    a => a.role === 'technician' && !a.custom_role_key && (!factoryId || !a.factory_id || a.factory_id === factoryId)
  )

  // Vendors scoped to this incident's factory, plus any that apply to every
  // factory (factory_id null).
  const factoryVendors = vendors.filter(v => !v.factory_id || !factoryId || v.factory_id === factoryId)

  function toggleVendor(name: string) {
    setSelectedVendorNames(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name])
  }

  function assignAllTechnicians() {
    setSelectedIds(prev => Array.from(new Set([...prev, ...factoryTechnicians.map(a => a.id)])))
  }

  // One quick-assign button per custom role that has members relevant to this
  // incident's factory — e.g. an admin-created "辦公室人員" role becomes
  // one-click assignable the moment accounts are put on it (Settings → 使用者
  // 管理), no code change needed.
  const customRoleGroups = customRoles
    .map(cr => ({
      role: cr,
      members: accounts.filter(a => a.custom_role_key === cr.key && (!factoryId || !a.factory_id || a.factory_id === factoryId)),
    }))
    .filter(g => g.members.length > 0)

  function assignGroup(memberIds: string[]) {
    setSelectedIds(prev => Array.from(new Set([...prev, ...memberIds])))
  }

  function clearAll() {
    // A technician who is mid-repair loses access to the case the moment they're
    // removed from the assignment (detail page guard), so confirm before wiping
    // everyone — this isn't a harmless UI reset.
    if (selectedIds.length > 0 &&
        !window.confirm(t('assign.confirmClearAll', '確定要清空所有指派嗎？被指派中的人員將無法再看到此工單。'))) {
      return
    }
    setSelectedIds([])
  }

  // Initial free-text names = whatever in assigned_to that doesn't match a
  // linked account name or a roster vendor name (e.g. ad-hoc names typed in
  // before the vendor existed in the roster, or a one-off name never added).
  useEffect(() => {
    if (accounts.length === 0) return
    const linkedNames = new Set(
      (assignedUserIds ?? [])
        .map(id => accounts.find(a => a.id === id)?.full_name)
        .filter(Boolean) as string[]
    )
    const vendorNames = new Set(vendors.map(v => v.name))
    const leftovers = (assignedTo ?? '')
      .split(/[,，]/).map(s => s.trim()).filter(Boolean)
      .filter(n => !linkedNames.has(n))
    setSelectedVendorNames(leftovers.filter(n => vendorNames.has(n)))
    setExtraNames(leftovers.filter(n => !vendorNames.has(n)).join(', '))
  }, [accounts, vendors])

  const accountName = (a: Account) => a.full_name || `(${ROLE_ZH[a.role] ?? a.role})`

  // With many users the chip list explodes — by default show only accounts
  // relevant to this incident (same factory / no factory / already selected).
  // Searching by name always looks across ALL accounts; a toggle reveals all.
  const CHIP_LIMIT = 12
  const relevantAccounts = useMemo(() => accounts.filter(a =>
    selectedIds.includes(a.id) || !a.factory_id || !factoryId || a.factory_id === factoryId
  ), [accounts, selectedIds, factoryId])
  const visibleAccounts = useMemo(() => {
    const q = accountSearch.trim().toLowerCase()
    if (q) return accounts.filter(a => (a.full_name ?? '').toLowerCase().includes(q))
    if (showAllAccounts || accounts.length <= CHIP_LIMIT) return accounts
    return relevantAccounts
  }, [accounts, relevantAccounts, accountSearch, showAllAccounts])
  const hiddenCount = accounts.length - visibleAccounts.length

  function toggle(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function save() {
    if (!canAssign) { toast.error(t('assign.onlySupervisor', '只有主管可以派工')); return }
    setSubmitting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      // Build the display summary: linked account names + free-text extras.
      const accountNames = selectedIds
        .map(id => accounts.find(a => a.id === id))
        .filter(Boolean)
        .map(a => accountName(a as Account))
      const extras = extraNames.split(/[,，]/).map(s => s.trim()).filter(Boolean)
      const allNames = [...accountNames, ...selectedVendorNames, ...extras]
      const displaySummary = allNames.length > 0 ? allNames.join(', ') : null

      // Technicians' saves must not touch due_date at all — sending the
      // (disabled) field's value would still overwrite whatever a supervisor
      // set. Only include it when the role is allowed to edit it.
      const patch: Record<string, unknown> = {
        assigned_user_ids: selectedIds,
        assigned_to: displaySummary,
        assigned_dept: dept || null,
        updated_at: new Date().toISOString(),
      }
      if (canEditDueDate) patch.due_date = due || null

      const { error } = await supabase
        .from('incidents')
        .update(patch)
        .eq('id', incidentId)
      if (error) throw error

      await logAuditEvent(supabase, {
        userId: user?.id ?? null,
        userName: userName || null,
        actionType: 'assign',
        resourceType: 'incident',
        resourceId: incidentId,
        oldValue: { assigned_to: assignedTo },
        newValue: { assigned_to: displaySummary },
        changeSummary: displaySummary ? `已指派給 ${displaySummary}${dept ? ` · ${dept}` : ''}` : '已取消指派',
      })

      // Personal Telegram ping for NEWLY added assignees only (re-saving the
      // same assignment stays silent). Best-effort — never blocks the save.
      const previousIds = new Set(assignedUserIds ?? [])
      const addedUserIds = selectedIds.filter(id => !previousIds.has(id))
      if (addedUserIds.length > 0) {
        fetch(`/api/incidents/${incidentId}/notify-assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addedUserIds }),
        }).catch(() => {})
      }

      // If no internal account is on the assignment (vendor / free-text only, or
      // fully cleared), technicians can't see this case — only supervisors+ can.
      // Warn the assigner instead of a plain success, so a work order doesn't
      // silently vanish from every technician's board.
      if (selectedIds.length === 0) {
        toast.warning(t('assign.savedNoInternal', '已儲存，但未指派任何內部帳號 — 技師將看不到此工單，只有主管看得到'))
      } else {
        toast.success(t('assign.saved', '派工已更新'))
      }
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : (err && typeof err === 'object' && 'message' in err ? String((err as any).message) : '更新失敗'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-gray-900 flex items-center gap-1.5">
          <UserCheck className="w-4 h-4" /> {t('assign.title', '派工指派')}
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">{t('assign.sectionHint', '選誰來處理這張工單，可以多選')}</p>
      </div>

      {/* Account multi-select */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <Label>{t('assign.assignees', '負責人（可多選）')}</Label>
          {canAssign && (
            <div className="flex items-center gap-3 flex-wrap">
              {factoryTechnicians.length > 0 && (
                <button
                  type="button"
                  onClick={assignAllTechnicians}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  <Users className="w-3.5 h-3.5" />
                  {t('assign.allTechnicians', '指派給全部技師')} ({factoryTechnicians.length})
                </button>
              )}
              {customRoleGroups.map(({ role, members }) => (
                <button
                  key={role.key}
                  type="button"
                  onClick={() => assignGroup(members.map(m => m.id))}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  <Users className="w-3.5 h-3.5" />
                  {t('assign.allCustomRole', '指派給{role}').replace('{role}', customRoleLabel(role, locale))} ({members.length})
                </button>
              ))}
              {selectedIds.length > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-red-600"
                >
                  <X className="w-3.5 h-3.5" />
                  {t('assign.clearAll', '取消全部')}
                </button>
              )}
            </div>
          )}
        </div>
        {accounts.length === 0 ? (
          <p className="text-xs text-gray-400 mt-1">{t('assign.noAccounts', '尚無可指派的帳號')}</p>
        ) : (
          <>
            {/* Name search — only worth showing once the list is big */}
            {accounts.length > CHIP_LIMIT && (
              <Input
                value={accountSearch}
                onChange={e => setAccountSearch(e.target.value)}
                placeholder={t('assign.searchPlaceholder', '搜尋姓名…')}
                className="mt-1"
                disabled={!canAssign}
              />
            )}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {visibleAccounts.map(a => {
                const on = selectedIds.includes(a.id)
                return (
                  <button
                    key={a.id}
                    type="button"
                    disabled={!canAssign}
                    aria-pressed={on}
                    onClick={() => toggle(a.id)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    {on && <Check className="w-3 h-3" />}
                    {accountName(a)}
                  </button>
                )
              })}
              {visibleAccounts.length === 0 && (
                <p className="text-xs text-gray-400 py-1">{t('assign.noMatch', '找不到符合的帳號')}</p>
              )}
            </div>
            {/* Reveal cross-factory accounts hidden by the default filter */}
            {!accountSearch.trim() && hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAllAccounts(true)}
                className="mt-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                {t('assign.showAllAccounts', '顯示其他工廠人員（{count}）').replace('{count}', String(hiddenCount))}
              </button>
            )}
            {!accountSearch.trim() && showAllAccounts && accounts.length > CHIP_LIMIT && (
              <button
                type="button"
                onClick={() => setShowAllAccounts(false)}
                className="mt-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
              >
                {t('assign.showFactoryOnly', '只顯示本廠人員')}
              </button>
            )}
          </>
        )}
      </div>

      {/* Vendor roster — reusable chips maintained in Settings, so the same
          contractor name is consistent across incidents (no typos splitting
          KPI stats between "ABC 外包" and "ABC维修"). */}
      {factoryVendors.length > 0 && (
        <div>
          <Label>{t('assign.vendors', '常用廠商')}</Label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {factoryVendors.map(v => {
              const on = selectedVendorNames.includes(v.name)
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={!canAssign}
                  aria-pressed={on}
                  onClick={() => toggleVendor(v.name)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                  }`}
                >
                  {on && <Check className="w-3 h-3" />}
                  {v.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Free-text extra names — for one-off vendors not worth adding to the
          roster, or before it's been set up in Settings. */}
      <div>
        <Label>{t('assign.extraNames', '其他人員（外部/廠商，逗號分隔）')}</Label>
        <Input
          value={extraNames}
          onChange={e => setExtraNames(e.target.value)}
          placeholder={t('assign.extraPlaceholder', '如：ABC 外包, 王師傅')}
          className="mt-1"
          disabled={!canAssign}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>{t('assign.dept', '部門')}</Label>
          <Input
            value={dept}
            onChange={e => setDept(e.target.value)}
            placeholder={t('assign.deptPlaceholder', '如：機電課')}
            className="mt-1"
            disabled={!canAssign}
          />
        </div>
        <div>
          <Label>{t('assign.dueDate', '預計完成日')}</Label>
          <Input type="date" value={due} onChange={e => setDue(e.target.value)} className="mt-1" disabled={!canAssign || !canEditDueDate} />
          {canAssign && !canEditDueDate && (
            <p className="text-xs text-gray-400 mt-1">{t('assign.dueDateSupervisorOnly', '完成日由主管設定')}</p>
          )}
        </div>
      </div>

      <Button
        onClick={save}
        disabled={submitting || !canAssign}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-300 disabled:hover:bg-gray-300"
        title={!canAssign ? t('assign.onlySupervisor', '只有主管可以派工') : ''}
      >
        {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {t('assign.save', '儲存派工')}
      </Button>
    </div>
  )
}
