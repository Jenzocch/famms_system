import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { computeHealthScore } from '@/lib/health-score'

// POST /api/health-score — recalculate equipment health scores for the current
// user's factory and persist them (one latest row per machine).
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('factory_id')
    .eq('id', user.id)
    .single()
  if (!profile?.factory_id) {
    return NextResponse.json({ error: 'Factory tidak ditemukan' }, { status: 400 })
  }
  const factoryId = profile.factory_id

  const windowStart = new Date(Date.now() - 90 * 86400000).toISOString()

  // Machines in factory
  const { data: machines } = await supabase
    .from('machines')
    .select('id, machine_code')
    .eq('factory_id', factoryId)

  if (!machines || machines.length === 0) {
    return NextResponse.json({ scores: [] })
  }

  // Incidents in window for this factory
  const { data: incidents } = await supabase
    .from('incidents')
    .select('id, machine_id')
    .eq('factory_id', factoryId)
    .gte('reported_at', windowStart)

  const incidentIds = (incidents ?? []).map(i => i.id)

  // Actions (durations) for those incidents — incident_actions has no factory_id
  let actions: { incident_id: string; duration_minutes: number | null }[] = []
  if (incidentIds.length) {
    const { data } = await supabase
      .from('incident_actions')
      .select('incident_id, duration_minutes')
      .in('incident_id', incidentIds)
    actions = data ?? []
  }

  // Repeat-failure relations for those incidents
  let repeatIncidentIds = new Set<string>()
  if (incidentIds.length) {
    const { data: relations } = await supabase
      .from('incident_relations')
      .select('incident_id, relation_type')
      .eq('relation_type', 'repeat_failure')
      .in('incident_id', incidentIds)
    repeatIncidentIds = new Set((relations ?? []).map(r => r.incident_id))
  }

  // Overdue PM per machine (pending records scheduled before today)
  const today = new Date().toISOString().split('T')[0]
  const { data: schedules } = await supabase
    .from('pm_schedules')
    .select('id, machine_id')
    .eq('factory_id', factoryId)
  const scheduleToMachine = new Map<string, string>()
  ;(schedules ?? []).forEach(s => scheduleToMachine.set(s.id, s.machine_id))

  const pmOverdueByMachine = new Map<string, number>()
  const scheduleIds = (schedules ?? []).map(s => s.id)
  if (scheduleIds.length) {
    const { data: overdueRecs } = await supabase
      .from('pm_records')
      .select('pm_schedule_id, scheduled_date, status')
      .in('pm_schedule_id', scheduleIds)
      .eq('status', 'pending')
      .lt('scheduled_date', today)
    ;(overdueRecs ?? []).forEach(r => {
      const mid = scheduleToMachine.get(r.pm_schedule_id)
      if (mid) pmOverdueByMachine.set(mid, (pmOverdueByMachine.get(mid) ?? 0) + 1)
    })
  }

  // Aggregate per machine and compute
  const results = []
  for (const m of machines) {
    const machineIncidents = (incidents ?? []).filter(i => i.machine_id === m.id)
    const machineIncidentIds = new Set(machineIncidents.map(i => i.id))

    const failureCount90d = machineIncidents.length
    const downtimeMinutes = actions
      .filter(a => machineIncidentIds.has(a.incident_id))
      .reduce((sum, a) => sum + (a.duration_minutes || 0), 0)
    const downtimeHours90d = Math.round((downtimeMinutes / 60) * 10) / 10
    const repeatFailureCount = machineIncidents.filter(i => repeatIncidentIds.has(i.id)).length
    const pmOverdueCount = pmOverdueByMachine.get(m.id) ?? 0

    const { score } = computeHealthScore({
      failureCount90d,
      downtimeHours90d,
      repeatFailureCount,
      pmOverdueCount,
    })

    results.push({
      machine_id: m.id,
      machine_code: m.machine_code,
      score,
      failure_count_90d: failureCount90d,
      downtime_hours_90d: downtimeHours90d,
      repeat_failure_count: repeatFailureCount,
      pm_overdue_count: pmOverdueCount,
    })
  }

  // Persist: replace previous rows for these machines, then insert fresh
  const machineIds = machines.map(m => m.id)
  await supabase.from('equipment_health_scores').delete().in('machine_id', machineIds)
  if (results.length) {
    await supabase.from('equipment_health_scores').insert(
      results.map(r => ({
        machine_id: r.machine_id,
        score: r.score,
        failure_count_90d: r.failure_count_90d,
        downtime_hours_90d: r.downtime_hours_90d,
        repeat_failure_count: r.repeat_failure_count,
        pm_overdue_count: r.pm_overdue_count,
        last_updated: new Date().toISOString(),
      }))
    )
  }

  return NextResponse.json({ scores: results })
}
