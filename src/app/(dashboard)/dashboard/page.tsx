import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { addDays, addWeeks, addMonths } from 'date-fns'
import type { IncidentStatus } from '@/types'
import DashboardView, { DashboardRow } from '@/components/dashboard/DashboardView'
import { OPEN_STATUSES } from '@/lib/incident-display'

export const metadata = { title: 'Dashboard | FAMMS' }

const UNSPECIFIED = '__unspecified__'

// Row shapes for the two joined selects below. The untyped Supabase client
// (no generated Database type) infers embedded to-one relations as arrays,
// which doesn't match the actual single-row PostgREST response for these
// foreign keys — these interfaces describe the real shape returned.
interface ScheduleRow {
  id: string
  machine_id: string
  pm_type: string
  interval_days: number | null
  machines: { machine_name: string; machine_code: string | null } | null
}
interface MaintenanceLogRow {
  machine_id: string
  performed_at: string
}
interface PMRecordRow {
  pm_schedule_id: string
  completed_at: string | null
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

export default async function DashboardPage() {
  const user = await getCurrentUser()
  // capabilities.dashboard already IS PERMISSIONS.dashboard(user.role) unless
  // a custom role overrides it (see resolveRoleOverlay in lib/auth.ts).
  if (!user || !user.capabilities.dashboard) {
    redirect('/incidents')
  }

  const supabase = await createClient()

  // Scope incidents to the user's factory (admins without factory see all).
  // Filter to open statuses IN SQL: the dashboard only counts open cases, and
  // fetching "newest 500 of everything" then filtering in memory silently
  // undercounted open/urgent/stale once total history passed 500 rows —
  // old-but-still-open cases fell off the end.
  let incidentQuery = supabase
    .from('incidents')
    .select('id, incident_no, status, downtime_impact, incident_type, title, reported_at, updated_at, factory_id, factory:factories(name)')
    .in('status', OPEN_STATUSES)
    .order('reported_at', { ascending: false })
    .limit(1000)
  if (user.factory_id && user.role !== 'admin') incidentQuery = incidentQuery.eq('factory_id', user.factory_id)

  // Only maintenance within the last year can affect "overdue" (anything older
  // means the machine shows overdue either way) — time-bound the history reads
  // so the dashboard doesn't scan every row ever written.
  // Server Component: this runs once per request on the server, not on a
  // client re-render, so Date.now() here isn't the hydration/purity hazard
  // the rule is guarding against.
  // eslint-disable-next-line react-hooks/purity
  const historyFloor = new Date(Date.now() - 366 * 86400000).toISOString()

  // All four reads are independent — run them in parallel.
  const [{ data }, schedulesRes, logsRes, pmRecordsRes] = await Promise.all([
    incidentQuery,
    supabase
      .from('pm_schedules')
      .select('id, machine_id, pm_type, interval_days, machines(machine_name, machine_code)')
      .eq('is_active', true),
    supabase
      .from('maintenance_logs')
      .select('machine_id, performed_at')
      .gte('performed_at', historyFloor)
      .order('performed_at', { ascending: false })
      .limit(2000),
    supabase
      .from('pm_records')
      .select('pm_schedule_id, completed_at')
      .eq('status', 'completed')
      .gte('completed_at', historyFloor)
      .order('completed_at', { ascending: false })
      .limit(2000),
  ])

  const open = (data ?? []) as unknown as DashboardRow[]
  const schedules = (schedulesRes.data ?? []) as unknown as ScheduleRow[]
  const logs = (logsRes.data ?? []) as unknown as MaintenanceLogRow[]
  const pmRecords = (pmRecordsRes.data ?? []) as unknown as PMRecordRow[]

  // pm_records is keyed by pm_schedule_id, so map through the schedules.
  const scheduleToMachine: Record<string, string> = {}
  for (const s of schedules) scheduleToMachine[s.id] = s.machine_id

  // Build last-maintenance-date map from both sources
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

  const overdue = schedules
    .filter(s => s.machines)
    .map(s => {
      const lastMaintained = lastByMachine[s.machine_id] ?? null
      const dueDate = getNextDueDate(lastMaintained, s.pm_type, s.interval_days)
      // Server Component (see note above) — same false-positive purity flag.
      // eslint-disable-next-line react-hooks/purity
      const daysOverdue = Math.floor((Date.now() - dueDate.getTime()) / 86400000)
      return {
        machine_id: s.machine_id,
        machine_name: s.machines!.machine_name,
        machine_code: s.machines!.machine_code,
        pm_type: s.pm_type,
        days_overdue: daysOverdue,
      }
    })
    .filter(m => m.days_overdue > 0)
    .sort((a, b) => b.days_overdue - a.days_overdue)
    .slice(0, 10)

  // Open count per factory (keep factory_id so the row can link to a filtered list)
  const byFactory = new Map<string, { count: number; factoryId: string | null }>()
  for (const r of open) {
    const name = r.factory?.name || UNSPECIFIED
    const prev = byFactory.get(name)
    byFactory.set(name, {
      count: (prev?.count ?? 0) + 1,
      factoryId: prev?.factoryId ?? r.factory_id ?? null,
    })
  }

  // Action inbox — the three queues a supervisor drains daily. Keys map to the
  // board's filter tabs so each card deep-links to the matching filtered list.
  const WAITING: IncidentStatus[] = ['waiting_parts', 'waiting_approval', 'waiting_vendor', 'waiting_shutdown']
  const inbox = {
    reported: open.filter(r => r.status === 'reported').length,
    waiting: open.filter(r => WAITING.includes(r.status)).length,
    confirm: open.filter(r => r.status === 'testing' || r.status === 'observation').length,
  }

  // "Urgent" = Critical (A). (The old 'B' tier was retired and its rows
  // normalized to 'A'.)
  const urgent = open.filter(r => r.downtime_impact === 'A')
  // Server Component (see note above) — same false-positive purity flag.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()
  const stale = open.filter(r => now - new Date(r.updated_at).getTime() > 3 * 86400000)
  const byFactoryEntries: [string, number, string | null][] =
    [...byFactory.entries()].map(([name, v]) => [name, v.count, v.factoryId])

  return (
    <DashboardView
      openCount={open.length}
      urgentCount={urgent.length}
      staleCount={stale.length}
      inbox={inbox}
      byFactory={byFactoryEntries}
      urgent={urgent}
      stale={stale}
      overdue={overdue}
      userRole={user.role}
    />
  )
}
