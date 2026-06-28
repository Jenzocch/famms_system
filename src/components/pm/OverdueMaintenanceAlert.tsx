'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AlertTriangle, Clock } from 'lucide-react'
import { formatDistanceToNow, addDays, addWeeks, addMonths } from 'date-fns'
import { zhTW } from 'date-fns/locale'

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
  daily: '每日',
  weekly: '每週',
  monthly: '每月',
  quarterly: '每季',
  half_yearly: '每半年',
  yearly: '每年',
  custom: '自訂天數',
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
  const supabase = createClient()
  const [overdue, setOverdue] = useState<OverdueMachine[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadOverdue()
  }, [])

  async function loadOverdue() {
    try {
      // Get all active PM schedules with machine info
      const { data: schedules } = await supabase
        .from('pm_schedules')
        .select(`
          id, machine_id, pm_type, interval_days,
          machines(id, machine_name, machine_code)
        `)
        .eq('is_active', true)

      if (!schedules || schedules.length === 0) {
        setOverdue([])
        setLoading(false)
        return
      }

      // Get last maintenance date for each machine
      const { data: logs } = await supabase
        .from('maintenance_logs')
        .select('machine_id, performed_at')
        .order('performed_at', { ascending: false })

      const lastByMachine: Record<string, string> = {}
      if (logs) {
        for (const log of logs) {
          if (!lastByMachine[log.machine_id]) {
            lastByMachine[log.machine_id] = log.performed_at
          }
        }
      }

      // Calculate overdue machines
      const now = new Date()
      const overdueList = (schedules as any[])
        .filter(s => s.machines)
        .map(s => {
          const lastMaintained = lastByMachine[s.machine_id]
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
    return <div className="text-center text-gray-500 text-sm py-4">檢查中...</div>
  }

  if (overdue.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-amber-600">
        <AlertTriangle className="w-5 h-5" />
        <h3 className="font-semibold text-sm">
          {overdue.length} 台機器逾期未保養
        </h3>
      </div>

      <div className="space-y-2">
        {overdue.map(m => (
          <div
            key={m.machine_id}
            className="bg-amber-50 border border-amber-200 rounded-lg p-3"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="font-medium text-sm text-gray-900">
                  {m.machine_code ? `[${m.machine_code}] ` : ''}{m.machine_name}
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  保養頻率: {PM_TYPE_LABELS[m.pm_type] || m.pm_type}
                </p>
                {m.last_maintained_at && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    上次保養: {formatDistanceToNow(new Date(m.last_maintained_at), { addSuffix: true, locale: zhTW })}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-red-600">
                  逾期 {m.days_overdue} 天
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
