'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AlertTriangle } from 'lucide-react'
import { formatDistanceToNow, addDays, addWeeks, addMonths } from 'date-fns'
import { zhTW, id as idLocale, enUS } from 'date-fns/locale'
import type { Locale as DateFnsLocale } from 'date-fns'
import { useI18n } from '@/lib/i18n'

interface OverdueMachine {
  machine_id: string
  machine_name: string
  machine_code: string | null
  pm_type: string
  last_maintained_at: string | null
  due_date: Date
  days_overdue: number
}

const PM_TYPE_LABELS: Record<string, string> = {
  daily: '每日', weekly: '每週', monthly: '每月', quarterly: '每季',
  half_yearly: '每半年', yearly: '每年', custom: '自訂天數',
}

const PM_TYPE_KEYS: Record<string, string> = {
  daily: 'pm.cadDaily', weekly: 'pm.cadWeekly', monthly: 'pm.cadMonthly',
  quarterly: 'pm.cadQuarterly', half_yearly: 'pm.cadHalfYearly',
  yearly: 'pm.cadYearly', custom: 'pm.cadCustom',
}

const DATE_LOCALES: Record<string, DateFnsLocale> = {
  zh: zhTW,
  en: enUS,
  id: idLocale,
}

function getNextDueDate(lastMaintained: string | null, pmType: string, intervalDays?: number | null): Date {
  const base = lastMaintained ? new Date(lastMaintained) : new Date()
  switch (pmType) {
    case 'daily': return addDays(base, 1)
    case 'weekly': return addWeeks(base, 1)
    case 'monthly': return addMonths(base, 1)
    case 'quarterly': return addMonths(base, 3)
    case 'half_yearly': return addMonths(base, 6)
    case 'yearly': return addMonths(base, 12)
    case 'custom': return addDays(base, intervalDays && intervalDays > 0 ? intervalDays : 30)
    default: return addMonths(base, 1)
  }
}

export default function OverdueMaintenanceAlert() {
  const { t, locale } = useI18n()
  const supabase = createClient()
  const dateLocale = DATE_LOCALES[locale]
  const pmTypeLabel = (pmType: string) =>
    t(PM_TYPE_KEYS[pmType] ?? '', PM_TYPE_LABELS[pmType] || pmType)
  const [overdue, setOverdue] = useState<OverdueMachine[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadOverdue() }, [])

  async function loadOverdue() {
    try {
      const { data: schedules } = await supabase
        .from('pm_schedules')
        .select('id, machine_id, pm_type, interval_days, machines(id, machine_name, machine_code)')
        .eq('is_active', true)

      if (!schedules || schedules.length === 0) {
        setOverdue([])
        setLoading(false)
        return
      }

      // Check both maintenance_logs and pm_records for last-done date
      const [logsRes, pmRecordsRes] = await Promise.all([
        supabase.from('maintenance_logs').select('machine_id, performed_at').order('performed_at', { ascending: false }),
        supabase.from('pm_records').select('machine_id, performed_date').eq('status', 'completed').order('performed_date', { ascending: false }),
      ])

      const lastByMachine: Record<string, string> = {}
      const recordLatest = (machineId: string, date: string) => {
        const existing = lastByMachine[machineId]
        if (!existing || date > existing) lastByMachine[machineId] = date
      }
      for (const log of logsRes.data ?? []) recordLatest(log.machine_id, log.performed_at)
      for (const rec of pmRecordsRes.data ?? []) recordLatest(rec.machine_id, rec.performed_date)

      const now = new Date()
      const overdueList = (schedules as any[])
        .filter(s => s.machines)
        .map(s => {
          const lastMaintained = lastByMachine[s.machine_id] ?? null
          const dueDate = getNextDueDate(lastMaintained, s.pm_type, s.interval_days)
          const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / 86400000)
          return {
            machine_id: s.machine_id,
            machine_name: s.machines.machine_name,
            machine_code: s.machines.machine_code,
            pm_type: s.pm_type,
            last_maintained_at: lastMaintained,
            due_date: dueDate,
            days_overdue: daysOverdue,
          }
        })
        .filter(m => m.days_overdue > 0)
        .sort((a, b) => b.days_overdue - a.days_overdue)

      setOverdue(overdueList)
    } catch (err) {
      console.error('Failed to load overdue machines:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="text-center text-gray-500 text-sm py-4">{t('pm.loadingCheck')}</div>
  }

  if (overdue.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-amber-600">
        <AlertTriangle className="w-5 h-5" />
        <h3 className="font-semibold text-sm">
          {t('pm.machinesOverdue').replace('{count}', String(overdue.length))}
        </h3>
      </div>

      <div className="space-y-2">
        {overdue.map(m => (
          <div key={m.machine_id} className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="font-medium text-sm text-gray-900">
                  {m.machine_code ? `[${m.machine_code}] ` : ''}{m.machine_name}
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  {t('pm.maintenanceFreq')}: {pmTypeLabel(m.pm_type)}
                </p>
                {m.last_maintained_at && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {t('pm.lastMaintained2')}: {formatDistanceToNow(new Date(m.last_maintained_at), { addSuffix: true, locale: dateLocale })}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-red-600">
                  {t('pm.overdueDays').replace('{count}', String(m.days_overdue))}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
