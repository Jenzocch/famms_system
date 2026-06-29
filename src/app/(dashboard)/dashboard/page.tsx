import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, PERMISSIONS } from '@/lib/auth'
import { addDays, addWeeks, addMonths } from 'date-fns'
import { IncidentStatus } from '@/types'
import DashboardView, { DashboardRow } from '@/components/dashboard/DashboardView'

export const metadata = { title: '主管追蹤 | 維修系統' }

const UNSPECIFIED = '__unspecified__'

const OPEN_STATUSES: IncidentStatus[] = [
  'reported', 'accepted', 'analyzing', 'waiting_parts', 'waiting_approval',
  'waiting_vendor', 'waiting_shutdown', 'repairing', 'testing', 'observation',
]

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
  if (!user || !PERMISSIONS.dashboard(user.role)) {
    redirect('/incidents')
  }

  const supabase = await createClient()

  // Scope incidents to the user's factory (admins without factory see all)
  let incidentQuery = supabase
    .from('incidents')
    .select('id, incident_no, status, downtime_impact, incident_type, title, reported_at, updated_at, factory:factories(name)')
    .order('reported_at', { ascending: false })
    .limit(500)
  if (user.factory_id && user.role !== 'admin') incidentQuery = incidentQuery.eq('factory_id', user.factory_id)

  const { data } = await incidentQuery
  const rows = (data ?? []) as unknown as DashboardRow[]
  const open = rows.filter(r => OPEN_STATUSES.includes(r.status))

  // Get overdue machines: fetch both maintenance_logs and pm_records to determine
  // the last actual maintenance date, whichever is more recent.
  const [schedulesRes, logsRes, pmRecordsRes] = await Promise.all([
    supabase
      .from('pm_schedules')
      .select('id, machine_id, pm_type, interval_days, machines(machine_name, machine_code)')
      .eq('is_active', true),
    supabase
      .from('maintenance_logs')
      .select('machine_id, performed_at')
      .order('performed_at', { ascending: false }),
    supabase
      .from('pm_records')
      .select('pm_schedule_id, completed_at')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false }),
  ])

  // pm_records is keyed by pm_schedule_id, so map through the schedules.
  const scheduleToMachine: Record<string, string> = {}
  for (const s of schedulesRes.data ?? []) scheduleToMachine[(s as any).id] = s.machine_id

  // Build last-maintenance-date map from both sources
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

  const overdue = (schedulesRes.data ?? [])
    .filter(s => (s as any).machines)
    .map(s => {
      const lastMaintained = lastByMachine[s.machine_id] ?? null
      const dueDate = getNextDueDate(lastMaintained, s.pm_type, (s as any).interval_days)
      const daysOverdue = Math.floor((Date.now() - dueDate.getTime()) / 86400000)
      return {
        machine_id: s.machine_id,
        machine_name: (s as any).machines.machine_name,
        machine_code: (s as any).machines.machine_code,
        pm_type: s.pm_type,
        days_overdue: daysOverdue,
      }
    })
    .filter(m => m.days_overdue > 0)
    .sort((a, b) => b.days_overdue - a.days_overdue)
    .slice(0, 10)

  // Open count per factory
  const byFactory = new Map<string, number>()
  for (const r of open) {
    const name = r.factory?.name || UNSPECIFIED
    byFactory.set(name, (byFactory.get(name) ?? 0) + 1)
  }

  const urgent = open.filter(r => r.downtime_impact === 'A' || r.downtime_impact === 'B')
  const now = Date.now()
  const stale = open.filter(r => now - new Date(r.updated_at).getTime() > 3 * 86400000)
  const byFactoryEntries: [string, number][] = [...byFactory.entries()]

  return (
    <DashboardView
      openCount={open.length}
      urgentCount={urgent.length}
      staleCount={stale.length}
      byFactory={byFactoryEntries}
      urgent={urgent}
      stale={stale}
      overdue={overdue}
    />
  )
}
