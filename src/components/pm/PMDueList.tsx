'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search, CalendarClock, CheckCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { toast } from 'sonner'

interface PMDueListProps {
  factoryId: string
}

interface Task {
  record_id: string
  schedule_id?: string
  checklist?: string[]
  projected?: boolean
  machine_id: string
  machine_name: string
  machine_code: string | null
  pm_type: string | null
  description: string | null
  scheduled_date: string
  status: string
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

// Only these statuses are "things a technician still needs to do".
const ACTIONABLE = new Set(['overdue', 'pending', 'scheduled'])

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime()
  const b = new Date(to + 'T00:00:00Z').getTime()
  return Math.round((b - a) / 86400000)
}

export default function PMDueList({ factoryId }: PMDueListProps) {
  const { t } = useI18n()
  const [tasks, setTasks] = useState<Task[]>([])

  // Red when overdue, amber when due within 3 days, otherwise blue.
  function dueMeta(date: string): { text: string; cls: string; dot: string } {
    const diff = daysBetween(todayStr(), date)
    if (diff < 0) return { text: t('pm.badgeOverdueDays', '逾期 {count} 天').replace('{count}', String(-diff)), cls: 'text-red-600 bg-red-50', dot: 'bg-red-500' }
    if (diff === 0) return { text: t('pm.dueToday', '今天到期'), cls: 'text-amber-600 bg-amber-50', dot: 'bg-amber-500' }
    if (diff <= 3) return { text: t('pm.badgeInDays', '{count} 天後').replace('{count}', String(diff)), cls: 'text-amber-600 bg-amber-50', dot: 'bg-amber-500' }
    return { text: t('pm.badgeInDays', '{count} 天後').replace('{count}', String(diff)), cls: 'text-blue-600 bg-blue-50', dot: 'bg-blue-500' }
  }
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  // Quick complete: first tap arms the confirm, second tap saves.
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [checks, setChecks] = useState<boolean[]>([])
  const [savingId, setSavingId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!factoryId) { setTasks([]); return }
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        // Look ahead across this month + next two months so upcoming work shows.
        const now = new Date()
        const months = [0, 1, 2].map(offset => {
          const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() + offset, 1))
          return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
        })

        // Fetch all months in parallel (sequential fetches made the list slow).
        const results = await Promise.all(
          months.map(month =>
            fetch(`/api/pm/calendar?factory_id=${factoryId}&month=${month}`)
              .then(res => (res.ok ? res.json() : null))
              .catch(() => null)
          )
        )

        const all: Task[] = []
        for (const data of results) {
          if (!data) continue
          for (const day of (data.events || [])) {
            for (const task of (day.tasks || [])) {
              if (ACTIONABLE.has(task.status)) all.push(task as Task)
            }
          }
        }

        // De-dupe by machine + date + type (a projected and stored copy can overlap across windows).
        const seen = new Set<string>()
        const deduped = all.filter(t => {
          const key = `${t.machine_id}|${t.scheduled_date}|${t.pm_type}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        deduped.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))

        if (!cancelled) setTasks(deduped)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [factoryId, reloadKey])

  // Complete a task straight from the list. Projected occurrences are
  // materialised by POST /api/pm/records; stored ones PATCH in place.
  async function completeTask(task: Task) {
    setSavingId(task.record_id)
    try {
      const checklist = task.checklist ?? []
      const checklist_results = checklist.length > 0
        ? checklist.map((item, i) => ({ item, done: checks[i] ?? false }))
        : undefined
      const res = task.projected
        ? await fetch('/api/pm/records', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pm_schedule_id: task.schedule_id,
              scheduled_date: task.scheduled_date,
              status: 'completed',
              checklist_results,
            }),
          })
        : await fetch(`/api/pm/records/${task.record_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'completed', checklist_results }),
          })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error || 'failed')
      }
      toast.success(t('pm.completedMaintenance', '保養已完成'))
      setReloadKey(k => k + 1)
    } catch (err) {
      toast.error(err instanceof Error && err.message !== 'failed' ? err.message : t('pm.saveFailed2', '儲存失敗'))
    } finally {
      setSavingId(null)
      setConfirmId(null)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tasks
    return tasks.filter(t =>
      t.machine_name.toLowerCase().includes(q) ||
      (t.machine_code || '').toLowerCase().includes(q)
    )
  }, [tasks, search])

  const overdueCount = tasks.filter(t => daysBetween(todayStr(), t.scheduled_date) < 0).length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-gray-700 text-sm flex items-center gap-1.5">
          <CalendarClock className="w-4 h-4" /> {t('pm.dueTaskList', '保養待辦')}
          {overdueCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">{t('pm.overdue', '逾期')} {overdueCount}</span>
          )}
        </h2>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('pm.searchMachine', '搜尋機器名稱或代碼...')}
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-400">
          <Loader2 className="w-6 h-6 mx-auto animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center py-8 text-sm text-gray-400">
          {tasks.length === 0 ? t('pm.noUpcoming', '近期沒有待辦保養') : t('pm.noMatchingMachines', '找不到符合的機器')}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map(task => {
            const meta = dueMeta(task.scheduled_date)
            const arming = confirmId === task.record_id
            const saving = savingId === task.record_id
            const checklist = task.checklist ?? []
            return (
              <div key={task.record_id} className="bg-white rounded-xl border border-gray-200 p-3">
                <div className="flex items-center gap-3">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${meta.dot}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {task.machine_code ? `[${task.machine_code}] ` : ''}{task.machine_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {task.scheduled_date}
                      {task.pm_type && ` · ${t(PM_TYPE_KEYS[task.pm_type] ?? '', PM_TYPE_LABELS[task.pm_type] || task.pm_type)}`}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-1 rounded shrink-0 ${meta.cls}`}>
                    {meta.text}
                  </span>
                  {arming ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        disabled={saving}
                        onClick={() => completeTask(task)}
                        className="h-8 bg-green-600 hover:bg-green-700 text-white gap-1"
                      >
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                        {t('pm.confirmDone', '確認完成')}
                      </Button>
                      <button
                        type="button"
                        aria-label={t('common.cancel', '取消')}
                        onClick={() => setConfirmId(null)}
                        className="p-1.5 text-gray-400 hover:text-gray-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setConfirmId(task.record_id); setChecks(checklist.map(() => false)) }}
                      className="h-8 shrink-0 gap-1 text-green-700 border-green-300 hover:bg-green-50"
                    >
                      <CheckCircle className="w-3.5 h-3.5" /> {t('pm.done', '完成')}
                    </Button>
                  )}
                </div>

                {/* Checklist tick-off expands while confirming */}
                {arming && checklist.length > 0 && (
                  <div className="mt-2 ml-5 space-y-1">
                    <p className="text-xs font-medium text-gray-500">{t('pm.checklistHeading', '檢查清單 Checklist')}</p>
                    {checklist.map((item, i) => (
                      <label key={i} className="flex items-start gap-2 text-sm text-gray-700 bg-gray-50 rounded-lg px-2.5 py-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checks[i] ?? false}
                          onChange={e => {
                            const next = [...checks]
                            next[i] = e.target.checked
                            setChecks(next)
                          }}
                          className="mt-0.5 w-4 h-4 accent-green-600 shrink-0"
                        />
                        <span className={checks[i] ? 'line-through text-gray-400' : ''}>{item}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
