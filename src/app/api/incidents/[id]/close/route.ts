import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkRCARequirement } from '@/lib/rca'
import { getCurrentUser, PERMISSIONS } from '@/lib/auth'

// POST /api/incidents/[id]/close — close an incident.
// Blocks closing when RCA is required (same failure_code >= 3x in 90d) but no
// RCA record exists for that failure_code yet.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  // Server-side guard: only supervisor+ may close (the client hides the option
  // for technicians, but the API must enforce it too — a technician closing a
  // case is exactly the review step we don't want to bypass).
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!PERMISSIONS.closeIncident(user.role)) {
    return NextResponse.json(
      { error: 'Hanya supervisor ke atas yang dapat menutup kasus' },
      { status: 403 }
    )
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { root_cause, completion_type, labor_cost, parts_cost, save_to_kb, repair_method, hygiene_confirmed } = body as {
    root_cause?: string
    completion_type?: string
    labor_cost?: number
    parts_cost?: number
    save_to_kb?: boolean
    repair_method?: string
    hygiene_confirmed?: boolean
  }

  const { data: incident, error: loadErr } = await supabase
    .from('incidents')
    .select('id, factory_id, machine_id, failure_code_id, status, accepted_at, title, description, incident_type, machine:machines(machine_name, machine_code)')
    .eq('id', id)
    .single()
  if (loadErr || !incident) {
    return NextResponse.json({ error: 'Kasus tidak ditemukan' }, { status: 404 })
  }

  if (incident.status === 'closed') {
    return NextResponse.json({ error: 'Kasus ini sudah ditutup' }, { status: 400 })
  }

  // completion_type (temporary_fix / permanent_fix) was only required by the
  // client form — calling this route directly skipped it entirely, silently
  // corrupting the First-Fix-Rate / repeat-failure KPIs that depend on it.
  if (completion_type !== 'temporary_fix' && completion_type !== 'permanent_fix') {
    return NextResponse.json(
      { error: '結案前請選擇修復類型（臨時 / 永久）' },
      { status: 400 }
    )
  }

  // Hygiene sign-off — food-safety gate for MACHINE incidents only. Maintenance
  // work is itself a contamination source (leftover tools, metal shavings,
  // non-food-grade lubricant), so a machine can't go back into production
  // without an explicit "the area was left clean" confirmation. Non-machine
  // incidents (facility/electrical/etc., no machine_id) never touch food
  // product, so this doesn't apply to them.
  if (incident.machine_id && hygiene_confirmed !== true) {
    return NextResponse.json(
      { error: '結案前請完成復產衛生確認 / Konfirmasi higiene sebelum menutup kasus' },
      { status: 400 }
    )
  }

  // RCA gate — only applies to machine incidents that carry a failure_code.
  // Facility / simplified incidents have no failure_code_id, so skip the check.
  if (incident.failure_code_id) {
    const rca = await checkRCARequirement(supabase, incident.failure_code_id, incident.factory_id)
    if (rca.required && !rca.satisfied) {
      return NextResponse.json(
        {
          error: 'RCA wajib diisi sebelum menutup kasus',
          rca_required: true,
          occurrence_count: rca.occurrenceCount,
        },
        { status: 409 }
      )
    }
  }

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = {
    status: 'closed',
    closed_at: now,
    closed_by_id: user.id,
    root_cause: root_cause || undefined,
    completion_type: completion_type || undefined,
    updated_at: now,
  }
  // Stamp accepted_at if the incident is closed without ever being "accepted"
  // (keeps the Response Time KPI from breaking on direct close).
  if (!incident.accepted_at) {
    patch.accepted_at = now
    patch.accepted_by_id = user.id
  }
  // Only machine incidents go through the gate above, so this is only ever
  // set when hygiene_confirmed === true.
  if (incident.machine_id) {
    patch.hygiene_confirmed_at = now
  }

  let { data: updated, error: updateErr } = await supabase
    .from('incidents')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()

  // DB without the hygiene_confirmed_at column yet (SYNC_SCHEMA_LATEST not
  // run): drop just that field and retry, so a schema-drift DB can't block
  // closing entirely. Postgres says 42703; PostgREST's schema cache says
  // PGRST204 — see submitIncidentReport.ts for the same pattern.
  if (updateErr && (updateErr.code === '42703' || updateErr.code === 'PGRST204') && 'hygiene_confirmed_at' in patch) {
    delete patch.hygiene_confirmed_at
    ;({ data: updated, error: updateErr } = await supabase
      .from('incidents')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single())
  }

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // Optional close-time costs (labor / parts). Non-fatal: a cost-insert
  // failure (e.g. migration not run yet) must never block the close itself.
  const costRows = [
    { type: 'labor', amount: labor_cost },
    { type: 'parts', amount: parts_cost },
  ].filter(c => typeof c.amount === 'number' && c.amount! > 0)
  let costsSaved = 0
  if (costRows.length > 0) {
    const { error: costErr } = await supabase.from('maintenance_costs').insert(
      costRows.map(c => ({
        factory_id: incident.factory_id,
        machine_id: incident.machine_id ?? null,
        incident_id: incident.id,
        cost_type: c.type,
        amount: c.amount,
        cost_date: now.slice(0, 10),
      }))
    )
    if (!costErr) costsSaved = costRows.length
  }

  // Optional knowledge-base capture — turns the close note into searchable
  // experience for the next technician. Non-fatal like the cost insert.
  let kbSaved = false
  if (save_to_kb && (root_cause || repair_method)) {
    const machine = incident.machine as unknown as { machine_name?: string; machine_code?: string | null } | null
    const problem = [incident.title, incident.description].filter(Boolean).join(' — ')
      || incident.incident_type
    const keywords = [machine?.machine_code, machine?.machine_name, incident.incident_type]
      .filter(Boolean).join(' ')
    const { error: kbErr } = await supabase.from('knowledge_base').insert({
      incident_id: incident.id,
      problem,
      root_cause: root_cause || repair_method || '-',
      repair_method: repair_method || root_cause || '-',
      keywords,
      created_by_id: user.id,
    })
    kbSaved = !kbErr
  }

  return NextResponse.json({ incident: updated, costs_saved: costsSaved, kb_saved: kbSaved })
}
