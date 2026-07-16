import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { wibTodayStr } from '@/lib/pm'
import { timingSafeEqualString } from '@/lib/timing-safe-equal'

// GET /api/external/machine-status?factory_code=DIN&machine_code=HMG-001
//
// Read-only endpoint for external systems (e.g. QC/FQMS) to check whether a
// machine's preventive maintenance is up to date before signing off a QC
// check. FAMMS stays the source of truth for maintenance data; QC never
// touches our database directly.
//
// Auth: Authorization: Bearer ${QC_API_SECRET}. Runs with the service-role
// client — there is no user session on an external server-to-server call.
export async function GET(req: Request) {
  const secret = process.env.QC_API_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || !auth || !timingSafeEqualString(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const factoryCode = searchParams.get('factory_code')
  const machineCode = searchParams.get('machine_code')
  if (!factoryCode || !machineCode) {
    return NextResponse.json({ error: 'factory_code and machine_code required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: factory } = await supabase
    .from('factories')
    .select('id, code')
    .eq('code', factoryCode)
    .single()
  if (!factory) {
    return NextResponse.json({ error: 'factory not found' }, { status: 404 })
  }

  const { data: machine } = await supabase
    .from('machines')
    .select('id, machine_code, machine_name, status')
    .eq('factory_id', factory.id)
    .eq('machine_code', machineCode)
    .single()
  if (!machine) {
    return NextResponse.json({ error: 'machine not found' }, { status: 404 })
  }

  // PM overdue: pending records whose scheduled_date has passed. Factory-local
  // (WIB, UTC+7) date, not toISOString()'s UTC date — otherwise "today" lags
  // by one day between WIB 00:00-07:00, letting ok_to_run/maintenance_ok
  // report "up to date" for up to 7 hours after a PM is genuinely overdue.
  const today = wibTodayStr()
  const { data: schedules } = await supabase
    .from('pm_schedules')
    .select('id')
    .eq('machine_id', machine.id)
  const scheduleIds = (schedules ?? []).map(s => s.id)

  let pmOverdueCount = 0
  let lastPmCompletedAt: string | null = null
  if (scheduleIds.length) {
    const { count } = await supabase
      .from('pm_records')
      .select('id', { count: 'exact', head: true })
      .in('pm_schedule_id', scheduleIds)
      .eq('status', 'pending')
      .lt('scheduled_date', today)
    pmOverdueCount = count ?? 0

    const { data: lastCompleted } = await supabase
      .from('pm_records')
      .select('completed_at')
      .in('pm_schedule_id', scheduleIds)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    lastPmCompletedAt = lastCompleted?.completed_at ?? null
  }

  // Cached health score (populated by POST /api/health-score); may be null if
  // that recalculation has never run for this machine.
  const { data: healthScore } = await supabase
    .from('equipment_health_scores')
    .select('score, last_updated')
    .eq('machine_id', machine.id)
    .order('last_updated', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { count: openIncidentCount } = await supabase
    .from('incidents')
    .select('id', { count: 'exact', head: true })
    .eq('machine_id', machine.id)
    .neq('status', 'closed')

  // Single verdict for QC: machine is running, PM is up to date, and no open
  // repair case. Informational context for IPQC pre-checks, not a hard gate.
  const okToRun =
    machine.status === 'running' &&
    pmOverdueCount === 0 &&
    (openIncidentCount ?? 0) === 0

  return NextResponse.json({
    machine_id: machine.id,
    machine_code: machine.machine_code,
    machine_name: machine.machine_name,
    factory_code: factory.code,
    status: machine.status,
    ok_to_run: okToRun,
    maintenance_ok: pmOverdueCount === 0,
    pm_overdue_count: pmOverdueCount,
    last_pm_completed_at: lastPmCompletedAt,
    health_score: healthScore?.score ?? null,
    health_score_updated_at: healthScore?.last_updated ?? null,
    open_incident_count: openIncidentCount ?? 0,
  })
}
