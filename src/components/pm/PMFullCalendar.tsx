'use client'

import { useEffect, useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight, X, CheckCircle, SkipForward, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { useI18n } from '@/lib/i18n'

interface PMTask {
  record_id: string
  projected: boolean
  ad_hoc?: boolean
  machine_id: string
  machine_name: string
  machine_code: string | null
  pm_type: string | null
  description: string | null
  scheduled_date: string
  completed_at: string | null
  status: 'pending' | 'completed' | 'overdue' | 'skipped' | 'scheduled'
  cost: number | null
  delay_reason: string | null
  performed_by?: string | null
}

interface PMEvent {
  date: string
  tasks: PMTask[]
}

interface MachineOption {
  id: string
  machine_name: string
  machine_code: string | null
}

interface PMFullCalendarProps {
  factoryId: string
}

const PM_TYPE_LABELS: Record<string, string> = {
  daily: '每日', weekly: '每週', monthly: '每月',
  quarterly: '每季', half_yearly: '每半年', yearly: '每年', custom: '自訂天數',
}

const PM_TYPE_KEYS: Record<string, string> = {
  daily: 'pm.cadDaily', weekly: 'pm.cadWeekly', monthly: 'pm.cadMonthly',
  quarterly: 'pm.cadQuarterly', half_yearly: 'pm.cadHalfYearly', yearly: 'pm.cadYearly', custom: 'pm.cadCustom',
}

const STATUS_KEYS: Record<string, string> = {
  completed: 'pm.stCompleted',
  pending: 'pm.stPending',
  scheduled: 'pm.stScheduled',
  overdue: 'pm.stOverdue',
  skipped: 'pm.stSkipped',
}

const STATUS_DOT: Record<string, string> = {
  completed: 'bg-green-500',
  pending: 'bg-blue-500',
  scheduled: 'bg-indigo-300',
  overdue: 'bg-red-500',
  skipped: 'bg-gray-400',
}

const STATUS_CARD: Record<string, string> = {
  completed: 'bg-green-50 border-green-200 text-green-800',
  pending: 'bg-blue-50 border-blue-200 text-blue-800',
  scheduled: 'bg-indigo-50 border-indigo-200 text-indigo-700',
  overdue: 'bg-red-50 border-red-200 text-red-800',
  skipped: 'bg-gray-50 border-gray-200 text-gray-600',
}

const STATUS_BADGE: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  pending: 'bg-blue-100 text-blue-700',
  scheduled: 'bg-indigo-100 text-indigo-700',
  overdue: 'bg-red-100 text-red-700',
  skipped: 'bg-gray-100 text-gray-600',
}

const STATUS_LABELS: Record<string, string> = {
  completed: '已完成',
  pending: '待處理',
  scheduled: '預定',
  overdue: '逾期',
  skipped: '已跳過',
}

const DAY_ABBRS = ['日', '一', '二', '三', '四', '五', '六']

// A task can be actioned (completed/skipped) only if it's a real, not-yet-done record.
function isActionable(task: PMTask) {
  return !task.projected && (task.status === 'pending' || task.status === 'overdue')
}

function getWeekDates(date: Date): string[] {
  const d = new Date(date)
  const day = d.getDay()
  const sunday = new Date(d)
  sunday.setDate(d.getDate() - day)
  return Array.from({ length: 7 }, (_, i) => {
    const wd = new Date(sunday)
    wd.setDate(sunday.getDate() + i)
    return wd.toISOString().split('T')[0]
  })
}

export default function PMFullCalendar({ factoryId }: PMFullCalendarProps) {
  const { t } = useI18n()
  // Short label for a task's kind: cadence or ad-hoc maintenance label.
  const typeLabel = (task: PMTask): string => {
    if (task.ad_hoc) return t('pm.adhocLabel')
    const key = PM_TYPE_KEYS[task.pm_type || '']
    return key ? t(key, PM_TYPE_LABELS[task.pm_type || ''] || task.pm_type || '') : (task.pm_type || '')
  }
  const statusLabel = (status: string) =>
    t(STATUS_KEYS[status] ?? '', STATUS_LABELS[status] || status)
  const dayAbbr = (idx: number) => t(`weekdays.${idx}`, DAY_ABBRS[idx])
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month')
  const [selectedMachineId, setSelectedMachineId] = useState('all')
  const [events, setEvents] = useState<PMEvent[]>([])
  const [machines, setMachines] = useState<MachineOption[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  // Inline action state for completing/skipping a real task from the detail panel
  const [action, setAction] = useState<{ taskId: string; mode: 'complete' | 'skip'; findings: string; cost: string; reason: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const today = new Date().toISOString().split('T')[0]

  const weekDates = getWeekDates(currentDate)

  const monthStr = viewMode === 'week'
    ? weekDates[0].slice(0, 7)
    : `${year}-${String(month + 1).padStart(2, '0')}`

  useEffect(() => {
    setSelectedDate(null)
    setAction(null)
    loadData()
  }, [factoryId, monthStr, selectedMachineId])

  async function loadData() {
    setLoading(true)
    try {
      let url = `/api/pm/calendar?factory_id=${factoryId}&month=${monthStr}`
      if (selectedMachineId !== 'all') url += `&machine_id=${selectedMachineId}`
      const res = await fetch(url)
      const data = await res.json()
      setEvents(data.events || [])
      if (data.machines?.length > 0) setMachines(data.machines)
    } catch {
      toast.error(t('pm.loadFailed2'))
    } finally {
      setLoading(false)
    }
  }

  async function submitAction() {
    if (!action) return
    if (action.mode === 'skip' && !action.reason.trim()) {
      toast.error(t('pm.skipReasonRequired2'))
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/pm/records/${action.taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: action.mode === 'complete' ? 'completed' : 'skipped',
          findings: action.findings || undefined,
          cost: action.cost ? parseFloat(action.cost) : undefined,
          delay_reason: action.mode === 'skip' ? action.reason : undefined,
        }),
      })
      if (!res.ok) throw new Error('failed')
      toast.success(action.mode === 'complete' ? t('pm.completedMaintenance') : t('pm.skippedDone'))
      setAction(null)
      loadData()
    } catch {
      toast.error(t('pm.saveFailed2'))
    } finally {
      setSubmitting(false)
    }
  }

  const eventMap = useMemo(() => {
    const map: Record<string, PMTask[]> = {}
    for (const e of events) map[e.date] = e.tasks
    return map
  }, [events])

  // Month calendar grid
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDayOfWeek = new Date(year, month, 1).getDay()
  const calendarDays: (string | null)[] = [
    ...Array(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      `${year}-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`
    ),
  ]
  while (calendarDays.length % 7 !== 0) calendarDays.push(null)

  function navigatePrev() {
    const d = new Date(currentDate)
    if (viewMode === 'month') d.setMonth(d.getMonth() - 1)
    else d.setDate(d.getDate() - 7)
    setCurrentDate(d)
  }

  function navigateNext() {
    const d = new Date(currentDate)
    if (viewMode === 'month') d.setMonth(d.getMonth() + 1)
    else d.setDate(d.getDate() + 7)
    setCurrentDate(d)
  }

  const monthHeader = t('pmCal.monthHeader').replace('{year}', String(year)).replace('{month}', String(month + 1))
  const weekHeader = `${weekDates[0].slice(5).replace('-', '/')} – ${weekDates[6].slice(5).replace('-', '/')}`
  const selectedTasks = selectedDate ? (eventMap[selectedDate] || []) : []

  // Dot priority for a day: which colored dots to render (deduped, capped)
  function dayDots(tasks: PMTask[]) {
    const set = new Set(tasks.map(task => task.status))
    const order = ['overdue', 'pending', 'scheduled', 'completed', 'skipped']
    return order.filter(s => set.has(s as PMTask['status']))
  }

  const machineItems: Record<string, string> = {
    all: t('pm.allMachines2'),
    ...Object.fromEntries(
      machines.map(m => [m.id, `${m.machine_code ? `[${m.machine_code}] ` : ''}${m.machine_name}`])
    ),
  }

  return (
    <div className="space-y-3">
      {/* Controls row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={selectedMachineId} onValueChange={v => setSelectedMachineId(v ?? 'all')} items={machineItems}>
          <SelectTrigger className="flex-1 min-w-36 text-xs h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('pm.allMachines2')}</SelectItem>
            {machines.map(m => (
              <SelectItem key={m.id} value={m.id}>
                {m.machine_code ? `[${m.machine_code}] ` : ''}{m.machine_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex rounded-md border border-gray-200 overflow-hidden text-xs shrink-0">
          <button
            onClick={() => setViewMode('month')}
            className={`px-3 py-1.5 ${viewMode === 'month' ? 'bg-blue-600 text-white font-semibold' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            {t('pm.monthBtn')}
          </button>
          <button
            onClick={() => setViewMode('week')}
            className={`px-3 py-1.5 border-l border-gray-200 ${viewMode === 'week' ? 'bg-blue-600 text-white font-semibold' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            {t('pm.weekBtn')}
          </button>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={navigatePrev}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div className="text-center">
          <p className="font-semibold text-sm text-gray-800">
            {viewMode === 'month' ? monthHeader : weekHeader}
          </p>
          <button onClick={() => setCurrentDate(new Date())} className="text-xs text-blue-500 hover:underline mt-0.5">
            {t('pm.todayBtn')}
          </button>
        </div>
        <Button variant="outline" size="sm" onClick={navigateNext}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {loading && (
        <div className="text-center py-6 text-sm text-gray-400">{t('common.loading')}</div>
      )}

      {/* Month view */}
      {!loading && viewMode === 'month' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="grid grid-cols-7 border-b border-gray-100">
            {DAY_ABBRS.map((d, i) => (
              <div key={d} className="text-center text-xs font-medium text-gray-400 py-2">{dayAbbr(i)}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {calendarDays.map((dateStr, idx) => {
              const tasks = dateStr ? (eventMap[dateStr] || []) : []
              const isToday = dateStr === today
              const isSelected = dateStr === selectedDate
              const dots = dayDots(tasks)

              return (
                <div
                  key={idx}
                  onClick={() => dateStr && setSelectedDate(isSelected ? null : dateStr)}
                  className={`min-h-14 p-1 border-b border-r border-gray-100 transition-colors ${
                    !dateStr ? 'bg-gray-50' :
                    isSelected ? 'bg-blue-50 cursor-pointer' :
                    'hover:bg-gray-50 cursor-pointer'
                  }`}
                >
                  {dateStr && (
                    <>
                      <div className={`text-xs font-semibold w-5 h-5 flex items-center justify-center rounded-full mb-1 ${
                        isToday ? 'bg-blue-600 text-white' : 'text-gray-700'
                      }`}>
                        {parseInt(dateStr.split('-')[2])}
                      </div>
                      <div className="flex flex-wrap gap-0.5">
                        {dots.map(s => (
                          <div key={s} className={`w-2 h-2 rounded-full ${STATUS_DOT[s]}`} />
                        ))}
                        {tasks.length > 1 && (
                          <span className="text-xs text-gray-400 leading-none self-end">{tasks.length}</span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Week view */}
      {!loading && viewMode === 'week' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="grid grid-cols-7">
            {weekDates.map((dateStr, idx) => {
              const tasks = eventMap[dateStr] || []
              const isToday = dateStr === today
              const isSelected = dateStr === selectedDate
              const dayNum = parseInt(dateStr.split('-')[2])

              return (
                <div
                  key={dateStr}
                  className={`border-r border-gray-100 last:border-r-0 ${isSelected ? 'bg-blue-50' : isToday ? 'bg-amber-50' : ''}`}
                >
                  <div
                    onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                    className={`text-center py-2 border-b border-gray-100 cursor-pointer ${isToday ? 'bg-amber-100' : 'bg-gray-50 hover:bg-gray-100'}`}
                  >
                    <div className="text-xs text-gray-400">{dayAbbr(idx)}</div>
                    <div className={`text-sm font-bold ${isToday ? 'text-blue-600' : 'text-gray-800'}`}>{dayNum}</div>
                  </div>
                  <div className="p-1 space-y-1 min-h-20">
                    {tasks.map(task => (
                      <div
                        key={task.record_id}
                        onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                        className={`text-xs rounded p-1 border cursor-pointer ${STATUS_CARD[task.status] || 'bg-gray-50 border-gray-200'}`}
                      >
                        <div className="font-semibold truncate leading-tight">
                          {task.machine_code || task.machine_name}
                        </div>
                        <div className="opacity-70 truncate">
                          {typeLabel(task)}
                        </div>
                      </div>
                    ))}
                    {tasks.length === 0 && (
                      <div className="text-xs text-gray-200 text-center pt-3">—</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Selected date detail */}
      {selectedDate && (
        <div className="bg-white rounded-xl border border-blue-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-blue-50 border-b border-blue-100">
            <h4 className="font-semibold text-sm text-blue-900">{selectedDate}</h4>
            <button onClick={() => { setSelectedDate(null); setAction(null) }} className="text-blue-400 hover:text-blue-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          {selectedTasks.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-5">{t('pm.noPlanToday')}</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {selectedTasks.map(task => {
                const acting = action?.taskId === task.record_id ? action : null
                return (
                  <div key={task.record_id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_DOT[task.status] || 'bg-gray-400'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-sm text-gray-800 truncate">
                            {task.machine_code ? `[${task.machine_code}] ` : ''}{task.machine_name}
                          </span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 shrink-0">
                            {typeLabel(task)}
                          </span>
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${STATUS_BADGE[task.status] || 'bg-gray-100 text-gray-600'}`}>
                            {statusLabel(task.status)}
                          </span>
                        </div>
                        {task.description && (
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.description}</p>
                        )}
                        {task.completed_at && (
                          <p className="text-xs text-green-600 mt-0.5">✓ {task.completed_at.slice(0, 10)}</p>
                        )}
                        {task.delay_reason && (
                          <p className="text-xs text-orange-600 mt-0.5">{task.delay_reason}</p>
                        )}

                        {/* Action buttons for real, not-yet-done tasks */}
                        {isActionable(task) && !acting && (
                          <div className="flex gap-2 mt-2">
                            <Button
                              size="sm"
                              className="h-7 gap-1 bg-green-600 hover:bg-green-700 text-xs"
                              onClick={() => setAction({ taskId: task.record_id, mode: 'complete', findings: '', cost: '', reason: '' })}
                            >
                              <CheckCircle className="w-3.5 h-3.5" /> {t('pm.complete')}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 border-orange-300 text-orange-600 hover:bg-orange-50 text-xs"
                              onClick={() => setAction({ taskId: task.record_id, mode: 'skip', findings: '', cost: '', reason: '' })}
                            >
                              <SkipForward className="w-3.5 h-3.5" /> {t('pm.skip')}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Inline complete form */}
                    {acting?.mode === 'complete' && (
                      <div className="mt-3 ml-5 space-y-2 bg-green-50 rounded-lg p-3 border border-green-200">
                        <Textarea
                          value={acting.findings}
                          onChange={e => setAction({ ...acting, findings: e.target.value })}
                          placeholder={t('pm.findingsPlaceholder')}
                          rows={2}
                          className="text-sm"
                        />
                        <Input
                          type="number"
                          value={acting.cost}
                          onChange={e => setAction({ ...acting, cost: e.target.value })}
                          placeholder={t('pm.costPlaceholder')}
                          className="text-sm"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-xs" onClick={submitAction} disabled={submitting}>
                            {submitting && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                            {t('pm.confirmComplete2')}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAction(null)}>{t('pm.cancelBtn')}</Button>
                        </div>
                      </div>
                    )}

                    {/* Inline skip form */}
                    {acting?.mode === 'skip' && (
                      <div className="mt-3 ml-5 space-y-2 bg-orange-50 rounded-lg p-3 border border-orange-200">
                        <Textarea
                          value={acting.reason}
                          onChange={e => setAction({ ...acting, reason: e.target.value })}
                          placeholder={t('pm.skipReasonPlaceholder')}
                          rows={2}
                          className="text-sm"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" className="h-7 border-orange-400 text-orange-700 hover:bg-orange-100 text-xs" onClick={submitAction} disabled={submitting || !acting.reason.trim()}>
                            {submitting && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                            {t('pm.confirmSkip2')}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAction(null)}>{t('pm.cancelBtn')}</Button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
        {[
          { dot: 'bg-green-500', label: t('pm.stCompleted') },
          { dot: 'bg-blue-500', label: t('pm.stPending') },
          { dot: 'bg-indigo-300', label: t('pm.stScheduled') },
          { dot: 'bg-red-500', label: t('pm.stOverdue') },
        ].map(item => (
          <div key={item.label} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${item.dot}`} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
