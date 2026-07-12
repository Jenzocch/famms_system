import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyAssignees, formatPartsStatus } from '@/lib/telegram'

// POST /api/external/parts-requests — write-back endpoint for Gudang One.
//
// When the warehouse processes a request placed via /api/gudang/request,
// Gudang One reports the outcome here using the famms_request_id it was
// handed at request time (= our parts_requests.id). FAMMS never polls;
// Gudang pushes only when something actually happened.
//
// Auth: Authorization: Bearer ${GUDANG_SYNC_SECRET} (server-to-server; no
// FAMMS user session involved, so this runs on the service-role client).
export async function POST(req: Request) {
  const secret = process.env.GUDANG_SYNC_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { request_id, status, external_ref } = body as {
    request_id?: string
    status?: string
    external_ref?: string
  }

  if (!request_id) {
    return NextResponse.json({ error: 'request_id required' }, { status: 400 })
  }
  // Gudang can move a request forward but never back to 'requested'.
  if (!status || !['ordered', 'received', 'rejected'].includes(status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 })
  }

  const update: Record<string, unknown> = {
    status,
    resolved_at: status === 'received' || status === 'rejected' ? new Date().toISOString() : null,
  }
  if (external_ref !== undefined) update.external_ref = external_ref?.trim() || null

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('parts_requests')
    .update(update)
    .eq('id', request_id)
    .select('id, status, external_ref, resolved_at, requested_by_id, items, incident:incidents(id, incident_no)')
    .single()

  if (error?.code === 'PGRST116') {
    return NextResponse.json({ error: 'request not found' }, { status: 404 })
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Tell the technician who placed the request — closes the loop instead of
  // leaving them to re-open the incident and check manually. Best-effort:
  // notifyAssignees already logs/swallows send failures internally.
  const incident = data.incident as unknown as { id: string; incident_no: string } | null
  const items = data.items as { name: string; qty: number; unit: string }[] | null
  if (data.requested_by_id && incident) {
    const itemsSummary = (items ?? []).map(it => `${it.name} ×${it.qty}${it.unit || ''}`).join('、')
    const html = formatPartsStatus({
      incidentNo: incident.incident_no,
      itemsSummary,
      status: status as 'ordered' | 'received' | 'rejected',
      appUrl: process.env.NEXT_PUBLIC_APP_URL,
      incidentId: incident.id,
    })
    await notifyAssignees(supabase, { profileIds: [data.requested_by_id], type: 'parts_status', html })
  }

  return NextResponse.json({ ok: true, request: data })
}
