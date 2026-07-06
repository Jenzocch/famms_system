import { createClient } from '@/lib/supabase/server'
import { occurrencesInWindow, toDateStr } from '@/lib/pm'
import type { PMType } from '@/types'

/**
 * GET /api/pm/calendar?factory_id=xxx&month=YYYY-MM&machine_id=xxx(optional)
 *
 * Returns PM events for a factory in a month, grouped by date.
 *
 * Three sources are merged so the calendar reflects ALL maintenance:
 *  1. Stored pm_records in the month → real status (completed/skipped/pending/overdue)
 *  2. Projected occurrences from active schedules → status 'scheduled' (planned)
 *     for any date with no stored record, so future months show planned work.
 *  3. Ad-hoc maintenance_logs → status 'completed', ad_hoc=true, so unplanned
 *     maintenance logged from the "Add Maintenance" form also appears here.
 *
 * Optional machine_id filters to a single machine.
 */
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const factoryId = url.searchParams.get('factory_id')
  const machineId = url.searchParams.get('machine_id') // optional filter
  const month = url.searchParams.get('month') // YYYY-MM

  if (!factoryId || !month) {
    return Response.json({ error: 'Missing factory_id or month' }, { status: 400 })
  }

  try {
    // All machines in this factory (optionally filtered) — used for names,
    // the filter dropdown, and ad-hoc log lookups.
    let machineQuery = supabase
      .from('machines')
      .select('id, machine_name, machine_code')
      .eq('factory_id', factoryId)
    if (machineId) machineQuery = machineQuery.eq('id', machineId)
    const { data: machines } = await machineQuery
    const machineMap = Object.fromEntries((machines || []).map(m => [m.id, m]))
    const factoryMachineIds = (machines || []).map(m => m.id)

    if (factoryMachineIds.length === 0) {
      return Response.json({ month, events: [], machines: [] })
    }

    // Active schedules for this factory (optionally filtered by machine).
    // assigned_user_ids / assigned_to only exist once migration_pm_assignee.sql
    // has run — if it hasn't, select+retry without them so the calendar still
    // works (assignee display/filter just stays empty until the migration runs).
    const BASE_COLS = 'id, machine_id, pm_type, interval_days, description, created_at'
    const scheduleSelect = async (cols: string) => {
      let q = supabase.from('pm_schedules').select(cols)
        .eq('factory_id', factoryId).eq('is_active', true)
      if (machineId) q = q.eq('machine_id', machineId)
      return q
    }
    let scheduleRes = await scheduleSelect(`${BASE_COLS}, assigned_user_ids, assigned_to`)
    if (scheduleRes.error) {
      scheduleRes = await scheduleSelect(BASE_COLS)
    }
    const scheduleList = (scheduleRes.data as any[]) || []
    const scheduleIds = scheduleList.map(s => s.id)
    const scheduleMap = Object.fromEntries(scheduleList.map(s => [s.id, s]))

    // Window for the visible month
    const monthStart = `${month}-01`
    const monthEndDate = new Date(month + '-01T00:00:00.000Z')
    monthEndDate.setUTCMonth(monthEndDate.getUTCMonth() + 1)
    const monthEnd = toDateStr(monthEndDate)

    const today = new Date().toISOString().split('T')[0]

    const byDate: Record<string, any[]> = {}
    // Track which (schedule, date) pairs already have a stored record so we
    // don't double-add a projected duplicate on top of a real one.
    const taken = new Set<string>()

    function pushTask(date: string, task: any) {
      if (!byDate[date]) byDate[date] = []
      byDate[date].push(task)
    }

    if (scheduleIds.length > 0) {
      // 1) Stored records in the window (real status)
      const { data: records } = await supabase
        .from('pm_records')
        .select('id, pm_schedule_id, scheduled_date, completed_at, status, delay_reason, cost')
        .in('pm_schedule_id', scheduleIds)
        .gte('scheduled_date', monthStart)
        .lt('scheduled_date', monthEnd)

      // 2) Anchor cadence per schedule from its latest known record date
      //    (falls back to schedule.created_at when no records exist yet).
      const { data: anchorRows } = await supabase
        .from('pm_records')
        .select('pm_schedule_id, scheduled_date')
        .in('pm_schedule_id', scheduleIds)
        .order('scheduled_date', { ascending: false })

      const anchorMap: Record<string, string> = {}
      for (const r of (anchorRows || [])) {
        if (!anchorMap[r.pm_schedule_id]) anchorMap[r.pm_schedule_id] = r.scheduled_date
      }
      for (const s of scheduleList) {
        if (!anchorMap[s.id]) anchorMap[s.id] = toDateStr(new Date(s.created_at))
      }

      // Stored records first
      for (const r of (records || [])) {
        const schedule = scheduleMap[r.pm_schedule_id]
        if (!schedule) continue
        const machine = machineMap[schedule.machine_id]
        if (!machine) continue

        const date = r.scheduled_date
        taken.add(`${r.pm_schedule_id}|${date}`)

        let status = r.status
        if (status === 'pending' && date < today) status = 'overdue'

        pushTask(date, {
          record_id: r.id,
          schedule_id: r.pm_schedule_id,
          projected: false,
          ad_hoc: false,
          machine_id: schedule.machine_id,
          machine_name: machine.machine_name,
          machine_code: machine.machine_code,
          pm_type: schedule.pm_type,
          description: schedule.description,
          scheduled_date: date,
          completed_at: r.completed_at,
          status,
          cost: r.cost,
          delay_reason: r.delay_reason,
          assigned_user_ids: schedule.assigned_user_ids ?? [],
          assigned_to: schedule.assigned_to ?? null,
        })
      }

      // Projected occurrences for every active schedule in the window
      for (const s of scheduleList) {
        const machine = machineMap[s.machine_id]
        if (!machine) continue

        const dates = occurrencesInWindow(anchorMap[s.id], s.pm_type as PMType, monthStart, monthEnd, (s as any).interval_days)
        for (const date of dates) {
          if (taken.has(`${s.id}|${date}`)) continue // real record already shown
          taken.add(`${s.id}|${date}`)

          // Past projected dates with no record read as overdue; today/future are planned.
          const status = date < today ? 'overdue' : 'scheduled'

          pushTask(date, {
            record_id: `proj-${s.id}-${date}`,
            schedule_id: s.id,
            projected: true,
            ad_hoc: false,
            machine_id: s.machine_id,
            machine_name: machine.machine_name,
            machine_code: machine.machine_code,
            pm_type: s.pm_type,
            description: s.description,
            scheduled_date: date,
            completed_at: null,
            status,
            cost: null,
            delay_reason: null,
            assigned_user_ids: (s as any).assigned_user_ids ?? [],
            assigned_to: (s as any).assigned_to ?? null,
          })
        }
      }
    }

    // 3) Ad-hoc maintenance logs (unplanned maintenance) in the window
    const { data: logs } = await supabase
      .from('maintenance_logs')
      .select('id, machine_id, performed_by, notes, performed_at')
      .in('machine_id', factoryMachineIds)
      .gte('performed_at', monthStart)
      .lt('performed_at', monthEnd + 'T00:00:00.000Z')
      .order('performed_at', { ascending: false })

    for (const log of (logs || [])) {
      const machine = machineMap[log.machine_id]
      if (!machine) continue
      const date = String(log.performed_at).slice(0, 10)

      pushTask(date, {
        record_id: `log-${log.id}`,
        projected: false,
        ad_hoc: true,
        machine_id: log.machine_id,
        machine_name: machine.machine_name,
        machine_code: machine.machine_code,
        pm_type: null,
        description: log.notes,
        scheduled_date: date,
        completed_at: log.performed_at,
        status: 'completed',
        cost: null,
        delay_reason: null,
        performed_by: log.performed_by,
      })
    }

    const events = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, tasks]) => ({ date, tasks }))

    const machineList = (machines || []).map(m => ({
      id: m.id,
      machine_name: m.machine_name,
      machine_code: m.machine_code,
    }))

    return Response.json({ month, events, machines: machineList })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error'
    return Response.json({ error: message }, { status: 500 })
  }
}
