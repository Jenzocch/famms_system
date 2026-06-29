import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkRCARequirement } from '@/lib/rca'

// POST /api/incidents/[id]/close — close an incident.
// Blocks closing when RCA is required (same failure_code >= 3x in 90d) but no
// RCA record exists for that failure_code yet.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { root_cause, completion_type } = body as {
    root_cause?: string
    completion_type?: string
  }

  const { data: incident, error: loadErr } = await supabase
    .from('incidents')
    .select('id, factory_id, failure_code_id, status, accepted_at')
    .eq('id', id)
    .single()
  if (loadErr || !incident) {
    return NextResponse.json({ error: 'Incident tidak ditemukan' }, { status: 404 })
  }

  if (incident.status === 'closed') {
    return NextResponse.json({ error: 'Incident sudah ditutup' }, { status: 400 })
  }

  // RCA gate — only applies to machine incidents that carry a failure_code.
  // Facility / simplified incidents have no failure_code_id, so skip the check.
  if (incident.failure_code_id) {
    const rca = await checkRCARequirement(supabase, incident.failure_code_id, incident.factory_id)
    if (rca.required && !rca.satisfied) {
      return NextResponse.json(
        {
          error: 'RCA wajib diisi sebelum menutup incident',
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

  const { data: updated, error: updateErr } = await supabase
    .from('incidents')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ incident: updated })
}
