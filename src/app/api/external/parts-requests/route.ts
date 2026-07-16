import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyAssignees, formatPartsStatus } from '@/lib/telegram'
import { timingSafeEqualString } from '@/lib/timing-safe-equal'

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
  if (!secret || !auth || !timingSafeEqualString(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { request_id, famms_request_id, status, external_ref } = body as {
    request_id?: string
    famms_request_id?: string
    status?: string
    external_ref?: string
  }
  // The outbound push to Gudang (src/app/api/gudang/request/route.ts) sends
  // this id as `famms_request_id`, not `request_id` — accept either name so
  // the write-back works regardless of which one Gudang's implementation
  // actually echoes back (this internal naming mismatch was never verified
  // against Gudang's real payload).
  const requestId = request_id || famms_request_id

  if (!requestId) {
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

  // Server-to-server webhooks get retried when the sender misses our response
  // — make the write-back idempotent. If the status isn't actually changing,
  // acknowledge without re-updating and (crucially) without re-notifying the
  // technician "your part arrived" a second time.
  const { data: before } = await supabase
    .from('parts_requests')
    .select('id, status')
    .eq('id', requestId)
    .maybeSingle()
  if (!before) {
    return NextResponse.json({ error: 'request not found' }, { status: 404 })
  }
  if (before.status === status) {
    return NextResponse.json({ ok: true, request: before, unchanged: true })
  }

  // Monotonic state machine: the comment above says "forward but never back
  // to requested", but the code only excluded that one literal string —
  // ordered/received/rejected could jump in ANY order among themselves. A
  // reordered or duplicate-retried webhook delivery (e.g. 'received' then
  // 'ordered' arriving out of order) could move a request BACKWARD, null out
  // resolved_at, and re-notify the technician with stale/wrong info. received
  // and rejected are both terminal — once resolved either way, no further
  // status change is accepted.
  const STATUS_RANK: Record<string, number> = { requested: 0, ordered: 1, received: 2, rejected: 2 }
  const beforeRank = STATUS_RANK[before.status] ?? 0
  if (beforeRank >= 2) {
    return NextResponse.json(
      { error: `request already resolved (${before.status}), ignoring status change to ${status}` },
      { status: 409 }
    )
  }
  if (STATUS_RANK[status] < beforeRank) {
    return NextResponse.json(
      { error: `cannot move status backward from ${before.status} to ${status}` },
      { status: 409 }
    )
  }

  const { data, error } = await supabase
    .from('parts_requests')
    .update(update)
    .eq('id', requestId)
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
