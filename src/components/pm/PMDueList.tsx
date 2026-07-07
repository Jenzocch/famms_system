'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search, CalendarClock } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

interface PMDueListProps {
  factoryId: string
}

interface Task {
  record_id: string
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

        const all: Task[] = []
        for (const month of months) {
          const res = await fetch(`/api/pm/calendar?factory_id=${factoryId}&month=${month}`)
          if (!res.ok) continue
          const data = await res.json()
          for (const day of (data.events || [])) {
            for (const t of (day.tasks || [])) {
              if (ACTIONABLE.has(t.status)) all.push(t as Task)
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
  }, [factoryId])

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
            return (
              <div
                key={task.record_id}
                className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 p-3"
              >
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
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
