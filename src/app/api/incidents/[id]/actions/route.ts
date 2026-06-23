import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/incidents/[id]/actions — add a repair action to an incident.
// Optionally advances the incident status (and completion_type for fixes).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: incidentId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    action_type,
    description,
    duration_minutes,
    labor_cost,
    material_cost,
    vendor_cost,
    new_status,        // optional: advance incident status
    completion_type,   // optional: 'temporary_fix' | 'permanent_fix'
    photos_before,     // optional: string[] storage paths
    photos_during,
    photos_after,
  } = body

  if (!action_type) {
    return NextResponse.json({ error: 'action_type wajib diisi' }, { status: 400 })
  }

  // Next sequence number for this incident
  const { count } = await supabase
    .from('incident_actions')
    .select('id', { count: 'exact', head: true })
    .eq('incident_id', incidentId)

  const { data: action, error: actionErr } = await supabase
    .from('incident_actions')
    .insert({
      incident_id: incidentId,
      action_sequence: (count ?? 0) + 1,
      action_type,
      description: description || null,
      performed_by_id: user.id,
      duration_minutes: duration_minutes || null,
      labor_cost: labor_cost || null,
      material_cost: material_cost || null,
      vendor_cost: vendor_cost || null,
      photos_before: photos_before?.length ? JSON.stringify(photos_before) : null,
      photos_during: photos_during?.length ? JSON.stringify(photos_during) : null,
      photos_after: photos_after?.length ? JSON.stringify(photos_after) : null,
      status: 'completed',
    })
    .select('*')
    .single()

  if (actionErr) {
    return NextResponse.json({ error: actionErr.message }, { status: 500 })
  }

  // Optionally advance the incident
  if (new_status || completion_type) {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (new_status) update.status = new_status
    if (completion_type) update.completion_type = completion_type

    // Stamp accepted_at the first time this incident moves past 'reported'
    // (whatever the target status). Used for the Response Time KPI.
    if (new_status && new_status !== 'reported') {
      const { data: current } = await supabase
        .from('incidents')
        .select('accepted_at')
        .eq('id', incidentId)
        .single()
      if (current && !current.accepted_at) {
        update.accepted_at = new Date().toISOString()
        update.accepted_by_id = user.id
      }
    }

    await supabase.from('incidents').update(update).eq('id', incidentId)
  }

  return NextResponse.json({ action })
}
