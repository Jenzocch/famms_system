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

// Raw pm_schedules row from the select below. `machines` is a single
// embedded object (each schedule has exactly one machine) — the untyped
// Supabase client just infers it as an array without a Database type.
interface ScheduleRow {
  id: string
  machine_id: string
  pm_type: string
  interval_days: number | null
  machines: { id: string; machine_name: string; machine_code: string | null } | null
}
interface LogRow { machine_id: string; performed_at: string }
interface RecordRow { pm_schedule_id: string; completed_at: string | null }

export function useOverdueMaintenanceData() {
  const supabase = createClient()
  const [overdue, setOverdue] = useState<OverdueMachine[]>([])
  const [loading, setLoading] = useState(true)

  async function loadOverdue() {
    try {
      const { data: schedulesRaw } = await supabase
        .from('pm_schedules')
        .select('id, machine_id, pm_type, interval_days, machines(id, machine_name, machine_code)')
        .eq('is_active', true)
      const schedules = (schedulesRaw ?? []) as unknown as ScheduleRow[]

      if (schedules.length === 0) {
        setOverdue([])
        setLoading(false)
        return
      }

      const scheduleToMachine: Record<string, string> = {}
      for (const s of schedules) scheduleToMachine[s.id] = s.machine_id

      const [logsRes, pmRecordsRes] = await Promise.all([
        supabase.from('maintenance_logs').select('machine_id, performed_at').order('performed_at', { ascending: false }),
        supabase.from('pm_records').select('pm_schedule_id, completed_at').eq('status', 'completed').order('completed_at', { ascending: false }),
      ])
      const logs = (logsRes.data ?? []) as unknown as LogRow[]
      const pmRecords = (pmRecordsRes.data ?? []) as unknown as RecordRow[]

      const lastByMachine: Record<string, string> = {}
      const recordLatest = (machineId: string, date: string) => {
        const existing = lastByMachine[machineId]
        if (!existing || date > existing) lastByMachine[machineId] = date
      }
      for (const log of logs) recordLatest(log.machine_id, log.performed_at)
      for (const rec of pmRecords) {
        const machineId = scheduleToMachine[rec.pm_schedule_id]
        if (machineId && rec.completed_at) recordLatest(machineId, rec.completed_at)
      }

      const now = new Date()
      const overdueList = schedules
        .filter(s => s.machines)
        .map(s => {
          const lastMaintained = lastByMachine[s.machine_id] ?? null
          const dueDate = getNextDueDate(lastMaintained, s.pm_type, s.interval_days)
          const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / 86400000)
          return {
            machine_id: s.machine_id,
            machine_name: s.machines!.machine_name,
            machine_code: s.machines!.machine_code,
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

  // Mount-only load. `loadOverdue` is intentionally omitted from deps: it's
  // a fresh function reference every render (closes over the unstable
  // `supabase` client), so adding it would re-run this effect on every
  // render. It's a multi-step async fetch (schedules -> logs/records ->
  // merge) with its own try/catch/finally, so it's kept as a reusable named
  // function rather than inlined into a .then() chain here.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { loadOverdue() }, [])

  return { overdue, loading }
}
