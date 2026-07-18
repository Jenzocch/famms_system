'use client'

import { useI18n } from '@/lib/i18n'

// zh fallbacks; rendered through t(pm.cad*) so labels follow app language —
// same map as PMDueList.tsx, duplicated locally to avoid a cross-feature import.
const PM_TYPE_LABELS: Record<string, string> = {
  daily: '每日', weekly: '每週', monthly: '每月',
  quarterly: '每季', half_yearly: '每半年', yearly: '每年', custom: '自訂天數',
}
const PM_TYPE_KEYS: Record<string, string> = {
  daily: 'pm.cadDaily', weekly: 'pm.cadWeekly', monthly: 'pm.cadMonthly',
  quarterly: 'pm.cadQuarterly', half_yearly: 'pm.cadHalfYearly',
  yearly: 'pm.cadYearly', custom: 'pm.cadCustom',
}

export interface PmScheduleStatus {
  id: string
  pm_type: string
  next_due_date: string // YYYY-MM-DD
}

function daysBetween(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime()
  const b = new Date(to + 'T00:00:00Z').getTime()
  return Math.round((b - a) / 86400000)
}

// PM status card for the machine detail page: next-due date per active
// schedule (color-coded like PMDueList's dueMeta()) plus the machine's last
// completed PM overall. A client component (like MachineStatsStrip next to
// it) purely for useI18n() — all data is computed server-side and passed down.
export default function MachinePmStatus({
  todayStr,
  schedules,
  lastCompletedDate,
}: {
  todayStr: string
  schedules: PmScheduleStatus[]
  lastCompletedDate: string | null
}) {
  const { t } = useI18n()

  function dueMeta(date: string): { cls: string; dot: string } {
    const diff = daysBetween(todayStr, date)
    if (diff < 0) return { cls: 'text-red-600 bg-red-50', dot: 'bg-red-500' }
    if (diff <= 3) return { cls: 'text-amber-600 bg-amber-50', dot: 'bg-amber-500' }
    return { cls: 'text-gray-600 bg-gray-50', dot: 'bg-gray-400' }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <h2 className="font-semibold text-gray-900">{t('machines.pmStatusTitle', '保養狀態')}</h2>

      {schedules.length === 0 ? (
        <p className="text-sm text-gray-400">{t('pm.noSchedules', '尚無保養計畫')}</p>
      ) : (
        <div className="space-y-2">
          {schedules.map(s => {
            const meta = dueMeta(s.next_due_date)
            return (
              <div key={s.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-gray-100">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
                  <span className="text-sm text-gray-700 truncate">
                    {t(PM_TYPE_KEYS[s.pm_type] ?? '', PM_TYPE_LABELS[s.pm_type] || s.pm_type)}
                  </span>
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded shrink-0 ${meta.cls}`}>
                  {t('pm.nextDue', '下次預定')}: {s.next_due_date}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <div className="pt-2 border-t border-gray-100 text-sm text-gray-600">
        {t('pm.lastMaintained', '上次保養')}: {lastCompletedDate ?? t('pm.neverCompleted', '從未完成')}
      </div>
    </div>
  )
}
