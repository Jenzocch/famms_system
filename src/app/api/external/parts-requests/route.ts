import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// POST /api/external/parts-requests — write-back endpoint for Gudang One.
//
// When the warehouse processes a FAMMS parts request, Gudang One reports the
// outcome here: order/receive/reject status, its own reference number, and —
// once FQMS has inspected the delivered batch — the QC verdict (qc_result).
// FAMMS never polls; Gudang pushes only when something actually happened.
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
  const { request_id, status, qc_result, external_ref } = body as {
    request_id?: string
    status?: string
    qc_result?: string | null
    external_ref?: string
  }

  if (!request_id) {
    return NextResponse.json({ error: 'request_id required' }, { status: 400 })
  }
  // Gudang can move a request forward but never back to 'requested'.
  if (status !== undefined && !['ordered', 'received', 'rejected'].includes(status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 })
  }
  if (qc_result !== undefined && qc_result !== null && !['passed', 'failed'].includes(qc_result)) {
    return NextResponse.json({ error: 'invalid qc_result' }, { status: 400 })
  }
  if (status === undefined && qc_result === undefined && external_ref === undefined) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if (status !== undefined) {
    update.status = status
    if (status === 'received' || status === 'rejected') {
      update.resolved_at = new Date().toISOString()
    }
  }
  if (qc_result !== undefined) update.qc_result = qc_result
  if (external_ref !== undefined) update.external_ref = external_ref?.trim() || null

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('parts_requests')
    .update(update)
    .eq('id', request_id)
    .select('id, status, qc_result, external_ref, resolved_at')
    .single()

  if (error?.code === 'PGRST116') {
    return NextResponse.json({ error: 'request not found' }, { status: 404 })
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, request: data })
}
