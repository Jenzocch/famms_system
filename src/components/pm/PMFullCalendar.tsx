'use client'

import { useEffect, useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useI18n } from '@/lib/i18n'
import { useOverdueMaintenanceData } from '@/lib/hooks/useOverdueMaintenanceData'
import OverdueBanner from './calendar/OverdueBanner'
import MonthGrid from './calendar/MonthGrid'
import WeekAgenda from './calendar/WeekAgenda'
import TaskDetailPanel, { type TaskActionPayload } from './calendar/TaskDetailPanel'
import { DATE_LOCALES, getWeekDates, type PMTask, type PMEvent, type MachineOption } from './calendar/types'

interface PMFullCalendarProps {
  factoryId: string
}

export default function PMFullCalendar({ factoryId }: PMFullCalendarProps) {
  const { t, locale } = useI18n()
  const dateLocale = DATE_LOCALES[locale]
  const { overdue, loading: overdueLoading } = useOverdueMaintenanceData()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month')
  const [selectedMachineId, setSelectedMachineId] = useState('all')
  const [events, setEvents] = useState<PMEvent[]>([])
  const [machines, setMachines] = useState<MachineOption[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [myId, setMyId] = useState<string | null>(null)
  const [onlyMine, setOnlyMine] = useState(false)

  // Current user id, so "only my maintenance" can filter to schedules this
  // person is assigned to. (getSession = local read, no network call.)
  useEffect(() => {
    createClient().auth.getSession().then(({ data }) => setMyId(data.session?.user.id ?? null))
  }, [])

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const today = new Date().toISOString().split('T')[0]

  const weekDates = getWeekDates(currentDate)

  const monthStr = viewMode === 'week'
    ? weekDates[0].slice(0, 7)
    : `${year}-${String(month + 1).padStart(2, '0')}`

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

  useEffect(() => {
    // Intentional reset-before-refetch: clears the day-detail selection
    // synchronously so a stale date from the previous month/filter doesn't
    // stay "selected" while the new data loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedDate(null)
    loadData()
    // `loadData` is intentionally omitted: it's a fresh function reference
    // every render, so adding it would re-run this on every render instead
    // of only when factoryId/monthStr/selectedMachineId change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factoryId, monthStr, selectedMachineId])

  // Called by TaskDetailPanel when the user confirms a complete/skip form.
  // Returns whether it succeeded so the panel knows to clear its form.
  async function submitAction(task: PMTask, mode: 'complete' | 'skip', payload: TaskActionPayload): Promise<boolean> {
    try {
      const checklist = task.checklist ?? []
      const body = {
        status: mode === 'complete' ? 'completed' : 'skipped',
        findings: payload.findings || undefined,
        cost: payload.cost ? parseFloat(payload.cost) : undefined,
        delay_reason: mode === 'skip' ? payload.reason : undefined,
        checklist_results: mode === 'complete' && checklist.length > 0
          ? checklist.map((item, i) => ({ item, done: payload.checks[i] ?? false }))
          : undefined,
      }
      // Projected occurrences have no stored record yet — POST materialises
      // one for (schedule, date). Stored records PATCH in place.
      const res = task.projected
        ? await fetch('/api/pm/records', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...body, pm_schedule_id: task.schedule_id, scheduled_date: task.scheduled_date }),
          })
        : await fetch(`/api/pm/records/${task.record_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error || 'failed')
      }
      toast.success(mode === 'complete' ? t('pm.completedMaintenance') : t('pm.skippedDone'))
      loadData()
      return true
    } catch {
      toast.error(t('pm.saveFailed2'))
      return false
    }
  }

  const eventMap = useMemo(() => {
    const map: Record<string, PMTask[]> = {}
    for (const e of events) {
      // "Only mine": keep tasks where the current user is among the assignees.
      const tasks = onlyMine && myId
        ? e.tasks.filter(task => (task.assigned_user_ids ?? []).includes(myId))
        : e.tasks
      if (tasks.length > 0) map[e.date] = tasks
    }
    return map
  }, [events, onlyMine, myId])

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

  const machineItems: Record<string, string> = {
    all: t('pm.allMachines2'),
    ...Object.fromEntries(
      machines.map(m => [m.id, `${m.machine_code ? `[${m.machine_code}] ` : ''}${m.machine_name}`])
    ),
  }

  return (
    <div className="space-y-3">
      {!overdueLoading && <OverdueBanner overdue={overdue} dateLocale={dateLocale} />}

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

        {/* Only my assigned maintenance */}
        {myId && (
          <button
            onClick={() => setOnlyMine(v => !v)}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md border text-xs shrink-0 ${
              onlyMine ? 'bg-blue-600 text-white border-blue-600 font-semibold' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            <Users className="w-3.5 h-3.5" /> {t('pm.onlyMine', '只看我的')}
          </button>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={navigatePrev} aria-label="Previous">
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
        <Button variant="outline" size="sm" onClick={navigateNext} aria-label="Next">
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {loading && (
        <div className="text-center py-6 text-sm text-gray-400">{t('common.loading')}</div>
      )}

      {!loading && viewMode === 'month' && (
        <MonthGrid
          calendarDays={calendarDays}
          eventMap={eventMap}
          today={today}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
      )}

      {!loading && viewMode === 'week' && (
        <WeekAgenda
          weekDates={weekDates}
          eventMap={eventMap}
          today={today}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
      )}

      {selectedDate && (
        <TaskDetailPanel
          selectedDate={selectedDate}
          tasks={selectedTasks}
          onClose={() => setSelectedDate(null)}
          onSubmitAction={submitAction}
        />
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
