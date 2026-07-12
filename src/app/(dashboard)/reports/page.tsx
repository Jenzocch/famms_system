import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getCurrentUser, PERMISSIONS } from '@/lib/auth'
import MonthlyReport, { ReportData, ReportIncidentRow } from '@/components/reports/MonthlyReport'

export const metadata = { title: 'Monthly Report | FAMMS' }

function monthWindow(month: string): { start: string; end: string } {
  const start = `${month}-01`
  const d = new Date(`${month}-01T00:00:00.000Z`)
  d.setUTCMonth(d.getUTCMonth() + 1)
  return { start, end: d.toISOString().slice(0, 10) }
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; factory?: string }>
}) {
  const user = await getCurrentUser()
  // The report is management-facing — same gate as the dashboard.
  if (!user || !PERMISSIONS.dashboard(user.role)) redirect('/incidents')

  const params = await searchParams
  const month = /^\d{4}-\d{2}$/.test(params.month ?? '')
    ? params.month!
    : new Date().toISOString().slice(0, 7)
  const { start, end } = monthWindow(month)

  const supabase = await createClient()

  const { data: factories } = await supabase.from('factories').select('id, name').order('name')
  // Factory scope: explicit param wins; otherwise the user's own factory;
  // admins without a factory default to all.
  const factoryId = params.factory === 'all'
    ? ''
    : (params.factory || user.factory_id || '')

  // All four reads are independent — one round-trip.
  let incidentQuery = supabase
    .from('incidents')
    .select(`
      id, incident_no, title, incident_type, status, downtime_impact,
      reported_at, accepted_at, closed_at, factory_id,
      machine:machines(machine_name, machine_code),
      factory:factories(name)
    `, { count: 'exact' })
    .gte('reported_at', `${start}T00:00:00Z`)
    .lt('reported_at', `${end}T00:00:00Z`)
    .order('reported_at', { ascending: true })
    .limit(1000)
  if (factoryId) incidentQuery = incidentQuery.eq('factory_id', factoryId)

  let pmQuery = supabase
    .from('pm_records')
    .select('id, status, scheduled_date, schedule:pm_schedules!inner(factory_id)', { count: 'exact' })
    .gte('scheduled_date', start)
    .lt('scheduled_date', end)
    .limit(2000)
  if (factoryId) pmQuery = pmQuery.eq('schedule.factory_id', factoryId)

  let logsQuery = supabase
    .from('maintenance_logs')
    .select('id, performed_at, machine:machines!inner(factory_id)', { count: 'exact' })
    .gte('performed_at', `${start}T00:00:00Z`)
    .lt('performed_at', `${end}T00:00:00Z`)
    .limit(2000)
  if (factoryId) logsQuery = logsQuery.eq('machine.factory_id', factoryId)

  let costsQuery = supabase
    .from('maintenance_costs')
    .select('cost_type, amount, cost_date', { count: 'exact' })
    .gte('cost_date', start)
    .lt('cost_date', end)
    .limit(2000)
  if (factoryId) costsQuery = costsQuery.eq('factory_id', factoryId)

  const [incidentsRes, pmRes, logsRes, costsRes] = await Promise.all([
    incidentQuery, pmQuery, logsQuery, costsQuery,
  ])

  const incidents = (incidentsRes.data ?? []) as unknown as ReportIncidentRow[]

  // Row caps exist so one huge month can't stall the page — but hitting one
  // must show a warning, not silently undercount the report.
  const hitCap = (res: { data: unknown[] | null; count: number | null }) =>
    (res.count ?? 0) > (res.data?.length ?? 0)
  const truncated = [incidentsRes, pmRes, logsRes, costsRes].some(r => hitCap(r as never))

  // ---- Aggregations (server-side so the client stays a dumb renderer) ----
  const closed = incidents.filter(i => i.status === 'closed')
  const urgent = incidents.filter(i => i.downtime_impact === 'A' || i.downtime_impact === 'B')

  const avg = (nums: number[]) =>
    nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length

  const responseMinutes = avg(
    incidents
      .filter(i => i.accepted_at)
      .map(i => (new Date(i.accepted_at!).getTime() - new Date(i.reported_at).getTime()) / 60000)
      .filter(m => m >= 0)
  )
  const resolutionHours = avg(
    closed
      .filter(i => i.closed_at)
      .map(i => (new Date(i.closed_at!).getTime() - new Date(i.reported_at).getTime()) / 3600000)
      .filter(h => h >= 0)
  )

  const byType: Record<string, number> = {}
  for (const i of incidents) byType[i.incident_type] = (byType[i.incident_type] ?? 0) + 1

  const byMachine: Record<string, number> = {}
  for (const i of incidents) {
    if (!i.machine) continue
    const label = `${i.machine.machine_code ? `[${i.machine.machine_code}] ` : ''}${i.machine.machine_name}`
    byMachine[label] = (byMachine[label] ?? 0) + 1
  }

  const pmRows = pmRes.data ?? []
  const pmDone = pmRows.filter(r => r.status === 'completed').length
  const pmSkipped = pmRows.filter(r => r.status === 'skipped').length

  const costRows = (costsRes.data ?? []) as { cost_type: string; amount: number | string }[]
  const costBy: Record<string, number> = {}
  for (const c of costRows) {
    const amt = typeof c.amount === 'string' ? parseFloat(c.amount) : c.amount
    if (!Number.isFinite(amt)) continue
    costBy[c.cost_type] = (costBy[c.cost_type] ?? 0) + amt
  }

  const data: ReportData = {
    month,
    factoryId: factoryId || 'all',
    factories: factories ?? [],
    totals: {
      incidents: incidents.length,
      closed: closed.length,
      open: incidents.length - closed.length,
      urgent: urgent.length,
      responseMinutes,
      resolutionHours,
      adhocJobs: (logsRes.data ?? []).length,
      pmScheduled: pmRows.length,
      pmCompleted: pmDone,
      pmSkipped,
    },
    byType: Object.entries(byType).sort((a, b) => b[1] - a[1]),
    byMachine: Object.entries(byMachine).sort((a, b) => b[1] - a[1]).slice(0, 10),
    costs: costBy,
    incidents,
    truncated,
  }

  return <MonthlyReport data={data} />
}
