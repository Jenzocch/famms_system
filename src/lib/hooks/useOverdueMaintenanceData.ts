'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { addDays, addWeeks, addMonths } from 'date-fns'

export interface OverdueMachine {
  machine_id: string
  machine_name: string
  machine_code: string | null
  pm_type: string
  last_maintained_at: string | null
  due_date: Date
  days_overdue: number
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

export function useOverdueMaintenanceData() {
  const supabase = createClient()
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

      const scheduleToMachine: Record<string, string> = {}
      for (const s of schedules as any[]) scheduleToMachine[s.id] = s.machine_id

      const [logsRes, pmRecordsRes] = await Promise.all([
        supabase.from('maintenance_logs').select('machine_id, performed_at').order('performed_at', { ascending: false }),
        supabase.from('pm_records').select('pm_schedule_id, completed_at').eq('status', 'completed').order('completed_at', { ascending: false }),
      ])

      const lastByMachine: Record<string, string> = {}
      const recordLatest = (machineId: string, date: string) => {
        const existing = lastByMachine[machineId]
        if (!existing || date > existing) lastByMachine[machineId] = date
      }
      for (const log of logsRes.data ?? []) recordLatest(log.machine_id, log.performed_at)
      for (const rec of pmRecordsRes.data ?? []) {
        const machineId = scheduleToMachine[(rec as any).pm_schedule_id]
        if (machineId && (rec as any).completed_at) recordLatest(machineId, (rec as any).completed_at)
      }

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

  return { overdue, loading }
}
