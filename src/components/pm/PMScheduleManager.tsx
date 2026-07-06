'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { Loader2, Plus, Trash2, Edit2, Users, Check, X } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import type { UserRole } from '@/types'
import { ROLE_ZH } from '@/lib/incident-display'
import { loadMyFactoryId } from '@/lib/useMyFactory'

interface Factory { id: string; name: string }
interface Area { id: string; factory_id: string; name: string }
interface Account { id: string; full_name: string | null; role: UserRole; factory_id: string | null }
interface Machine {
  id: string
  machine_name: string
  machine_code: string | null
  maintenance_cycle: number
}
interface PMSchedule {
  id: string
  machine_id: string
  pm_type: string
  interval_days: number | null
  description: string | null
  is_active: boolean
  assigned_user_ids: string[]
  assigned_to: string | null
  machine_name?: string
  machine_code?: string | null
}

const PM_TYPES = [
  { value: 'daily', label: '每日', labelKey: 'pm.cadDaily' },
  { value: 'weekly', label: '每週', labelKey: 'pm.cadWeekly' },
  { value: 'monthly', label: '每月', labelKey: 'pm.cadMonthly' },
  { value: 'quarterly', label: '每季', labelKey: 'pm.cadQuarterly' },
  { value: 'half_yearly', label: '每半年', labelKey: 'pm.cadHalfYearly' },
  { value: 'yearly', label: '每年', labelKey: 'pm.cadYearly' },
  { value: 'custom', label: '自訂天數', labelKey: 'pm.cadCustom' },
]

export default function PMScheduleManager() {
  const { t } = useI18n()
  const supabase = createClient()

  // Human label for a schedule's cadence, including custom "每 N 天".
  const pmTypeLabel = (pmType: string, intervalDays?: number | null): string => {
    if (pmType === 'custom') {
      return intervalDays
        ? t('pm.cadEveryNDays').replace('{days}', String(intervalDays))
        : t('pm.cadCustom')
    }
    const pt = PM_TYPES.find(pt => pt.value === pmType)
    return pt ? t(pt.labelKey, pt.label) : pmType
  }

  const [factories, setFactories] = useState<Factory[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [machines, setMachines] = useState<Machine[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [schedules, setSchedules] = useState<PMSchedule[]>([])
  const [loading, setLoading] = useState(true)

  const [factoryId, setFactoryId] = useState('')
  const [areaId, setAreaId] = useState('')
  const [machineId, setMachineId] = useState('')
  const [pmType, setPmType] = useState('monthly')
  const [intervalDays, setIntervalDays] = useState('')
  const [description, setDescription] = useState('')
  const [assignees, setAssignees] = useState<string[]>([])
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      supabase.from('factories').select('*').order('name'),
      loadMyFactoryId(),
    ]).then(([{ data }, myFactoryId]) => {
      setFactories(data ?? [])
      if (data && data.length > 0) {
        // Preselect the user's own factory so technicians see their machines.
        const preferred = myFactoryId && data.some(f => f.id === myFactoryId) ? myFactoryId : data[0].id
        setFactoryId(preferred)
      }
      setLoading(false)
    })
    supabase.from('profiles').select('id, full_name, role, factory_id').eq('is_active', true).order('full_name')
      .then(({ data }) => setAccounts((data ?? []) as Account[]))
    loadSchedules()
  }, [])

  const accountName = (a: Account) => a.full_name || `(${ROLE_ZH[a.role] ?? a.role})`
  const toggleAssignee = (id: string) =>
    setAssignees(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  // Technicians in the selected schedule's factory (cross-factory accounts also qualify).
  const factoryTechnicians = accounts.filter(
    a => a.role === 'technician' && (!factoryId || !a.factory_id || a.factory_id === factoryId)
  )

  useEffect(() => {
    if (!factoryId) { setAreas([]); setAreaId(''); return }
    supabase.from('areas').select('*').eq('factory_id', factoryId).order('name')
      .then(({ data }) => setAreas(data ?? []))
    setAreaId('')
  }, [factoryId])

  useEffect(() => {
    if (!areaId) { setMachines([]); setMachineId(''); return }
    supabase.from('machines').select('id, machine_name, machine_code, maintenance_cycle')
      .eq('area_id', areaId).neq('status', 'scrapped').order('machine_name')
      .then(({ data }) => setMachines(data ?? []))
    setMachineId('')
  }, [areaId])

  async function loadSchedules() {
    // assigned_user_ids / assigned_to only exist after migration_pm_assignee.sql.
    // Retry without them if the column is missing, so the list still loads.
    const withAssignee = `
        id, machine_id, pm_type, interval_days, description, is_active,
        assigned_user_ids, assigned_to,
        machines:machines(machine_name, machine_code)
      `
    const baseCols = `
        id, machine_id, pm_type, interval_days, description, is_active,
        machines:machines(machine_name, machine_code)
      `
    let res: any = await supabase
      .from('pm_schedules')
      .select(withAssignee)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
    if (res.error) {
      res = await supabase
        .from('pm_schedules')
        .select(baseCols)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
    }
    const data = res.data as any[] | null

    if (data) {
      const mapped = (data as any[]).map(s => ({
        id: s.id,
        machine_id: s.machine_id,
        pm_type: s.pm_type,
        interval_days: s.interval_days ?? null,
        description: s.description,
        is_active: s.is_active,
        assigned_user_ids: s.assigned_user_ids ?? [],
        assigned_to: s.assigned_to ?? null,
        machine_name: s.machines?.machine_name || '',
        machine_code: s.machines?.machine_code || null,
      }))
      setSchedules(mapped)
    }
  }

  async function submit() {
    if (!machineId) {
      toast.error(t('pm.selectMachineErr'))
      return
    }

    const days = parseInt(intervalDays, 10)
    if (pmType === 'custom' && (!days || days < 1)) {
      toast.error(t('pm.customDaysRequired'))
      return
    }
    const intervalValue = pmType === 'custom' ? days : null

    // Display summary of assigned people (account names), kept in sync with ids.
    const assignedTo = assignees
      .map(id => accounts.find(a => a.id === id))
      .filter(Boolean)
      .map(a => accountName(a as Account))
      .join(', ') || null

    setSubmitting(true)
    try {
      if (editingId) {
        // Assignee columns are optional (migration_pm_assignee.sql). Try with
        // them; if the column is missing, retry without so the edit still saves.
        const base = { pm_type: pmType, interval_days: intervalValue, description: description || null }
        let { error } = await supabase
          .from('pm_schedules')
          .update({ ...base, assigned_user_ids: assignees, assigned_to: assignedTo })
          .eq('id', editingId)
        if (error) {
          ({ error } = await supabase.from('pm_schedules').update(base).eq('id', editingId))
        }
        if (error) throw error
        toast.success(t('pm.scheduleUpdated'))
      } else {
        // Create through the API so the first pending pm_record is generated
        // too — a schedule without records only ever shows projected calendar
        // tasks. One code path for every creation source.
        const res = await fetch('/api/pm/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            machine_id: machineId,
            pm_type: pmType,
            interval_days: intervalValue,
            description: description || undefined,
            assigned_user_ids: assignees,
            assigned_to: assignedTo,
          }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => null)
          throw new Error(j?.error || t('pm.operationFailed'))
        }
        toast.success(t('pm.scheduleCreated'))
      }
      setMachineId('')
      setPmType('monthly')
      setIntervalDays('')
      setDescription('')
      setAssignees([])
      setShowForm(false)
      setEditingId(null)
      loadSchedules()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('pm.operationFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  async function removeSchedule(id: string) {
    if (!confirm(t('pm.confirmDeactivate'))) return
    try {
      const { error } = await supabase
        .from('pm_schedules')
        .update({ is_active: false })
        .eq('id', id)
      if (error) throw error
      toast.success(t('pm.deactivated'))
      loadSchedules()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('pm.deleteFailed'))
    }
  }

  if (loading) return <div className="text-center text-gray-500 text-sm py-4">{t('common.loading')}</div>

  // value→label maps so Base UI <SelectValue> shows names, not raw IDs/codes
  const factoryItems = Object.fromEntries(factories.map(f => [f.id, f.name]))
  const areaItems = Object.fromEntries(areas.map(a => [a.id, a.name]))
  const machineItems = Object.fromEntries(
    machines.map(m => [m.id, `${m.machine_code ? `[${m.machine_code}] ` : ''}${m.machine_name}`])
  )
  const pmTypeItems = Object.fromEntries(PM_TYPES.map(pt => [pt.value, t(pt.labelKey, pt.label)]))

  return (
    <div className="space-y-4">
      {!showForm && (
        <Button
          onClick={() => {
            setEditingId(null); setMachineId(''); setPmType('monthly')
            setIntervalDays(''); setDescription(''); setAssignees([])
            setShowForm(true)
          }}
          className="gap-2 w-full"
        >
          <Plus className="w-4 h-4" /> {t('pm.addSchedulePlan')}
        </Button>
      )}

      {showForm && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-blue-900">
            {editingId ? t('pm.editSchedulePlan') : t('pm.addSchedulePlan')}
          </p>

          <Select value={factoryId} onValueChange={(v) => setFactoryId(v ?? '')} items={factoryItems}>
            <SelectTrigger><SelectValue placeholder={t('pm.selectFactoryPh')} /></SelectTrigger>
            <SelectContent>
              {factories.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
            </SelectContent>
          </Select>

          {areas.length > 0 && (
            <Select value={areaId} onValueChange={(v) => setAreaId(v ?? '')} items={areaItems}>
              <SelectTrigger><SelectValue placeholder={t('pm.selectAreaPh')} /></SelectTrigger>
              <SelectContent>
                {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          {machines.length > 0 && (
            <Select value={machineId} onValueChange={(v) => setMachineId(v ?? '')} items={machineItems}>
              <SelectTrigger><SelectValue placeholder={t('pm.selectMachineStar')} /></SelectTrigger>
              <SelectContent>
                {machines.map(m => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.machine_code ? `[${m.machine_code}] ` : ''}{m.machine_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div>
            <Label>{t('pm.pmFrequency')}</Label>
            <Select value={pmType} onValueChange={(v) => setPmType(v ?? 'monthly')} items={pmTypeItems}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PM_TYPES.map(pt => <SelectItem key={pt.value} value={pt.value}>{t(pt.labelKey, pt.label)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {pmType === 'custom' && (
            <div>
              <Label>{t('pm.customDaysLabel')}</Label>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-sm text-gray-500">{t('pm.every')}</span>
                <input
                  type="number"
                  min={1}
                  value={intervalDays}
                  onChange={e => setIntervalDays(e.target.value)}
                  placeholder={t('pm.customDaysPlaceholder')}
                  className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <span className="text-sm text-gray-500">{t('pm.days')}</span>
              </div>
            </div>
          )}

          <div>
            <Label>{t('pm.notesOptional')}</Label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t('pm.notesPlaceholder')}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          {/* Responsible person(s) — who this maintenance is assigned to */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <Label>{t('pm.responsible', '負責人（可多選）')}</Label>
              <div className="flex items-center gap-3">
                {factoryTechnicians.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setAssignees(prev => Array.from(new Set([...prev, ...factoryTechnicians.map(a => a.id)])))}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    <Users className="w-3.5 h-3.5" /> {t('assign.allTechnicians', '指派給全部技師')} ({factoryTechnicians.length})
                  </button>
                )}
                {assignees.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setAssignees([])}
                    className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-red-600"
                  >
                    <X className="w-3.5 h-3.5" /> {t('assign.clearAll', '取消全部')}
                  </button>
                )}
              </div>
            </div>
            {accounts.length === 0 ? (
              <p className="text-xs text-gray-400 mt-1">{t('assign.noAccounts', '尚無可指派的帳號')}</p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {accounts.map(a => {
                  const on = assignees.includes(a.id)
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggleAssignee(a.id)}
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

          <div className="flex gap-2">
            <Button onClick={submit} disabled={submitting || !machineId}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingId ? t('pm.updatePlan') : t('pm.createPlan')}
            </Button>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditingId(null); setAssignees([]) }}>{t('pm.cancelBtn')}</Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {schedules.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">{t('pm.noSchedules')}</p>
        ) : (
          schedules.map(s => (
            <div key={s.id} className="flex items-center justify-between p-3 border rounded-lg bg-white">
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {s.machine_code ? `[${s.machine_code}] ` : ''}{s.machine_name}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {pmTypeLabel(s.pm_type, s.interval_days)}
                  {s.description && ` · ${s.description}`}
                </p>
                {s.assigned_to && (
                  <p className="text-xs text-blue-600 mt-0.5 flex items-center gap-1">
                    <Users className="w-3 h-3 shrink-0" /> {s.assigned_to}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingId(s.id)
                    setMachineId(s.machine_id)
                    setPmType(s.pm_type)
                    setIntervalDays(s.interval_days ? String(s.interval_days) : '')
                    setDescription(s.description || '')
                    setAssignees(s.assigned_user_ids ?? [])
                    setShowForm(true)
                  }}
                >
                  <Edit2 className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => removeSchedule(s.id)}
                >
                  <Trash2 className="w-4 h-4 text-red-600" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
