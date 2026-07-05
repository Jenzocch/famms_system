'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { Loader2, Plus, Wrench, Clock, CheckCircle, Settings } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useDateLocale } from '@/lib/date-locale'
import OverdueMaintenanceAlert from './OverdueMaintenanceAlert'
import PMScheduleManager from './PMScheduleManager'
import PMFullCalendar from './PMFullCalendar'
import PMDueList from './PMDueList'
import { useI18n } from '@/lib/i18n'

interface Factory { id: string; name: string }
interface Area { id: string; factory_id: string; name: string }
interface Machine {
  id: string
  area_id: string
  machine_name: string
  machine_code: string | null
  maintenance_cycle: number
  last_maintained_at?: string | null
}

// Unified recent-maintenance item — merges ad-hoc logs and scheduled PM completions
// so "最近保養紀錄" stays in sync with what the calendar shows.
interface RecentItem {
  id: string
  kind: 'adhoc' | 'scheduled'
  machineName: string | null
  performedBy: string | null
  notes: string | null
  when: string
  pmType?: string | null
  cost?: number | null
}

// zh fallbacks; rendered through t(pm.cad*) so labels follow app language.
const PM_TYPE_LABELS: Record<string, string> = {
  daily: '每日', weekly: '每週', monthly: '每月',
  quarterly: '每季', half_yearly: '每半年', yearly: '每年', custom: '自訂天數',
}
const PM_TYPE_KEYS: Record<string, string> = {
  daily: 'pm.cadDaily', weekly: 'pm.cadWeekly', monthly: 'pm.cadMonthly',
  quarterly: 'pm.cadQuarterly', half_yearly: 'pm.cadHalfYearly',
  yearly: 'pm.cadYearly', custom: 'pm.cadCustom',
}

export default function PMPage() {
  const supabase = createClient()
  const { t } = useI18n()
  const dateLocale = useDateLocale()

  const [factories, setFactories] = useState<Factory[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [machines, setMachines] = useState<Machine[]>([])
  const [recent, setRecent] = useState<RecentItem[]>([])

  const [factoryId, setFactoryId] = useState('')
  const [areaId, setAreaId] = useState('')
  const [selectedMachineId, setSelectedMachineId] = useState('')
  const [notes, setNotes] = useState('')
  const [performer, setPerformer] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showSchedules, setShowSchedules] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    supabase.from('factories').select('*').order('name').then(({ data }) => setFactories(data ?? []))
  }, [])

  useEffect(() => {
    if (!factoryId) { setAreas([]); setAreaId(''); return }
    supabase.from('areas').select('*').eq('factory_id', factoryId).order('name')
      .then(({ data }) => setAreas(data ?? []))
    setAreaId('')
  }, [factoryId])

  useEffect(() => {
    if (!areaId) { setMachines([]); return }
    supabase.from('machines').select('*').eq('area_id', areaId).neq('status', 'scrapped').order('machine_name')
      .then(({ data }) => setMachines(data ?? []))
  }, [areaId])

  useEffect(() => { loadRecent() }, [])

  async function loadRecent() {
    // Ad-hoc maintenance logs
    const { data: logs } = await supabase
      .from('maintenance_logs')
      .select('id, notes, performed_by, performed_at, machine:machines(machine_name, machine_code)')
      .order('performed_at', { ascending: false })
      .limit(50)

    // Completed scheduled PM records
    const { data: records } = await supabase
      .from('pm_records')
      .select('id, completed_at, findings, cost, schedule:pm_schedules(pm_type, machine:machines(machine_name, machine_code))')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(50)

    const adhoc: RecentItem[] = (logs ?? []).map((l: any) => ({
      id: `log-${l.id}`,
      kind: 'adhoc',
      machineName: l.machine
        ? `${l.machine.machine_code ? `[${l.machine.machine_code}] ` : ''}${l.machine.machine_name}`
        : null,
      performedBy: l.performed_by,
      notes: l.notes,
      when: l.performed_at,
    }))

    const scheduled: RecentItem[] = (records ?? []).map((r: any) => {
      const machine = r.schedule?.machine
      return {
        id: `rec-${r.id}`,
        kind: 'scheduled' as const,
        machineName: machine
          ? `${machine.machine_code ? `[${machine.machine_code}] ` : ''}${machine.machine_name}`
          : null,
        performedBy: null,
        notes: r.findings,
        when: r.completed_at,
        pmType: r.schedule?.pm_type ?? null,
        cost: r.cost,
      }
    })

    const merged = [...adhoc, ...scheduled]
      .filter(i => i.when)
      .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
      .slice(0, 30)

    setRecent(merged)
  }

  async function submitLog() {
    if (!selectedMachineId) { toast.error(t('pm.selectMachineErr')); return }

    setSubmitting(true)
    try {
      const { error } = await supabase.from('maintenance_logs').insert({
        machine_id: selectedMachineId,
        notes: notes || null,
        performed_by: performer || null,
        performed_at: new Date().toISOString(),
      })
      if (error) throw error
      toast.success(t('pm.recordAdded'))
      setNotes('')
      setPerformer('')
      setSelectedMachineId('')
      setShowForm(false)
      loadRecent()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('pm.addFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  // value→label maps so Base UI <SelectValue> shows names, not raw IDs/codes
  const factoryItems = Object.fromEntries(factories.map(f => [f.id, f.name]))
  const areaItems = Object.fromEntries(areas.map(a => [a.id, a.name]))
  const machineItems = Object.fromEntries(
    machines.map(m => [m.id, `${m.machine_code ? `[${m.machine_code}] ` : ''}${m.machine_name}`])
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t('pm.manageTitle')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('pm.manageSubtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowSchedules(!showSchedules)} variant="outline" className="gap-2">
            <Settings className="w-4 h-4" /> {t('pm.plansBtn')}
          </Button>
          <Button onClick={() => setShowForm(!showForm)} className="gap-2">
            <Plus className="w-4 h-4" /> {t('pm.addMaintenance')}
          </Button>
        </div>
      </div>

      {/* Factory selector */}
      <Select value={factoryId} onValueChange={(v) => { setFactoryId(v ?? ''); setAreaId('') }} items={factoryItems}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t('report.selectFactory')} />
        </SelectTrigger>
        <SelectContent>
          {factories.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
        </SelectContent>
      </Select>

      {/* Technician due-list: dates at a glance + search */}
      {factoryId && <PMDueList factoryId={factoryId} />}

      {/* Factory PM Calendar */}
      {factoryId && (
        <div className="space-y-2">
          <h2 className="font-semibold text-gray-700 text-sm">{t('pm.calendarHeading')}</h2>
          <PMFullCalendar factoryId={factoryId} />
        </div>
      )}

      {/* Overdue Alert */}
      <div className="border-l-4 border-amber-500 bg-amber-50 rounded-lg p-4">
        <OverdueMaintenanceAlert />
      </div>

      {/* PM Schedule Manager */}
      {showSchedules && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <PMScheduleManager />
        </div>
      )}

      {/* Add Maintenance Form */}
      {showForm && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-4">
          <h3 className="font-semibold text-blue-900">{t('pm.logMaintenance')}</h3>

          <Select value={factoryId} onValueChange={(v) => setFactoryId(v ?? '')} items={factoryItems}>
            <SelectTrigger><SelectValue placeholder={t('report.selectFactory')} /></SelectTrigger>
            <SelectContent>
              {factories.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
            </SelectContent>
          </Select>

          {areas.length > 0 && (
            <Select value={areaId} onValueChange={(v) => setAreaId(v ?? '')} items={areaItems}>
              <SelectTrigger><SelectValue placeholder={t('report.selectArea')} /></SelectTrigger>
              <SelectContent>
                {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          {machines.length > 0 && (
            <Select value={selectedMachineId} onValueChange={(v) => setSelectedMachineId(v ?? '')} items={machineItems}>
              <SelectTrigger><SelectValue placeholder={t('report.selectMachine')} /></SelectTrigger>
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
            <Label>{t('pm.maintainerName')}</Label>
            <input
              value={performer}
              onChange={e => setPerformer(e.target.value)}
              placeholder={t('pm.namePlaceholder')}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div>
            <Label>{t('pm.maintenanceNote')}</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={t('pm.notePlaceholder')}
              className="mt-1"
              rows={3}
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={submitLog} disabled={submitting || !selectedMachineId}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('pm.saveBtn')}
            </Button>
            <Button variant="outline" onClick={() => setShowForm(false)}>{t('common.cancel')}</Button>
          </div>
        </div>
      )}

      {/* Recent Records — merged ad-hoc logs + scheduled PM completions */}
      <div className="space-y-2">
        <h3 className="font-semibold text-gray-700 text-sm">{t('pm.recentRecords')}</h3>
        {recent.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <Wrench className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">{t('pm.noRecords')}</p>
          </div>
        ) : (
          recent.map(item => (
            <div key={item.id} className="bg-white rounded-xl border border-gray-200 p-3">
              <div className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {item.machineName && (
                      <span className="text-sm font-medium text-gray-800 truncate">{item.machineName}</span>
                    )}
                    <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                      item.kind === 'scheduled' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {item.kind === 'scheduled'
                        ? `${t('pm.plannedTag')}${item.pmType ? ` · ${t(PM_TYPE_KEYS[item.pmType] ?? '', PM_TYPE_LABELS[item.pmType] || item.pmType)}` : ''}`
                        : t('pm.adhocTag')}
                    </span>
                  </div>
                  {item.performedBy && (
                    <p className="text-xs text-gray-500 mt-0.5">{item.performedBy}</p>
                  )}
                  {item.notes && (
                    <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{item.notes}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDistanceToNow(new Date(item.when), { addSuffix: true, locale: dateLocale })}
                    {typeof item.cost === 'number' && item.cost > 0 && (
                      <span className="ml-1">· ${item.cost}</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
