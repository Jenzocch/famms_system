'use client'

import { useEffect, useState } from 'react'
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

interface Account { id: string; full_name: string | null; role: UserRole; factory_id: string | null }

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
  const { t } = useI18n()
  const canAssign = PERMISSIONS.assignIncident(userRole)

  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>(assignedUserIds ?? [])
  const [extraNames, setExtraNames] = useState('')
  const [dept, setDept] = useState(assignedDept || '')
  const [due, setDue] = useState(dueDate || '')
  const [submitting, setSubmitting] = useState(false)

  // Load assignable accounts (active users). Profiles has RLS disabled.
  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name, role, factory_id')
      .eq('is_active', true)
      .order('full_name')
      .then(({ data }) => setAccounts((data ?? []) as Account[]))
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
  // qualify). Used by the "assign all technicians" shortcut.
  const factoryTechnicians = accounts.filter(
    a => a.role === 'technician' && (!factoryId || !a.factory_id || a.factory_id === factoryId)
  )

  function assignAllTechnicians() {
    setSelectedIds(prev => Array.from(new Set([...prev, ...factoryTechnicians.map(a => a.id)])))
  }

  function clearAll() {
    setSelectedIds([])
  }

  // Initial free-text names = whatever in assigned_to that doesn't match a
  // linked account name (e.g. external vendors typed in before).
  useEffect(() => {
    if (accounts.length === 0) return
    const linkedNames = new Set(
      (assignedUserIds ?? [])
        .map(id => accounts.find(a => a.id === id)?.full_name)
        .filter(Boolean) as string[]
    )
    const leftovers = (assignedTo ?? '')
      .split(/[,，]/).map(s => s.trim()).filter(Boolean)
      .filter(n => !linkedNames.has(n))
    setExtraNames(leftovers.join(', '))
  }, [accounts])

  const accountName = (a: Account) => a.full_name || `(${ROLE_ZH[a.role] ?? a.role})`

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
      const allNames = [...accountNames, ...extras]
      const displaySummary = allNames.length > 0 ? allNames.join(', ') : null

      const { error } = await supabase
        .from('incidents')
        .update({
          assigned_user_ids: selectedIds,
          assigned_to: displaySummary,
          assigned_dept: dept || null,
          due_date: due || null,
          updated_at: new Date().toISOString(),
        })
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

      toast.success(t('assign.saved', '派工已更新'))
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : (err && typeof err === 'object' && 'message' in err ? String((err as any).message) : '更新失敗'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900 flex items-center gap-1.5">
        <UserCheck className="w-4 h-4" /> {t('assign.title', '派工指派')}
      </h3>


      {/* Account multi-select */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <Label>{t('assign.assignees', '負責人（可多選）')}</Label>
          {canAssign && (
            <div className="flex items-center gap-3">
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
          <div className="mt-1 flex flex-wrap gap-1.5">
            {accounts.map(a => {
              const on = selectedIds.includes(a.id)
              return (
                <button
                  key={a.id}
                  type="button"
                  disabled={!canAssign}
                  onClick={() => toggle(a.id)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                  }`}
                >
                  {on && <Check className="w-3 h-3" />}
                  {accountName(a)}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Free-text extra names (external vendors etc.) */}
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
          <Input type="date" value={due} onChange={e => setDue(e.target.value)} className="mt-1" disabled={!canAssign} />
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
