import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { NextResponse } from 'next/server'

// POST /api/gudang/request — forward a spare-part/material request for an
// incident to the Gudang One warehouse system (its famms-request Edge
// Function). The shared secret lives server-side only; the browser never
// sees the webhook URL or secret.
//
// env: GUDANG_WEBHOOK_URL    e.g. https://<project>.supabase.co/functions/v1/famms-request
//      GUDANG_WEBHOOK_SECRET shared secret, same value configured on the Gudang side

// FAMMS factory code → Gudang One warehouse code. A factory code NOT in this
// map (factories created after this was written — e.g. LAB) falls back to
// DEFAULT_WAREHOUSE instead of rejecting the request: blocking a technician's
// parts request over a missing mapping row helps nobody, and the payload note
// carries the real factory so warehouse staff can route it themselves.
const FACTORY_TO_WAREHOUSE: Record<string, string> = {
  DIN: 'DENIKIN',
  SJA: 'SJA',
  OLT: 'OLENTIA',
}
const DEFAULT_WAREHOUSE = process.env.GUDANG_DEFAULT_WAREHOUSE || 'DENIKIN'

type ItemInput = { name?: unknown; part_no?: unknown; qty?: unknown; unit?: unknown }

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user || !user.is_active) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.GUDANG_WEBHOOK_URL
  const secret = process.env.GUDANG_WEBHOOK_SECRET
  if (!url || !secret) {
    return NextResponse.json(
      { error: 'GUDANG_WEBHOOK_URL / GUDANG_WEBHOOK_SECRET belum dikonfigurasi' },
      { status: 500 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const incidentId = typeof body.incident_id === 'string' ? body.incident_id : ''
  const urgency = ['low', 'normal', 'urgent'].includes(body.urgency) ? body.urgency : 'normal'
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : ''
  const rawItems: ItemInput[] = Array.isArray(body.items) ? body.items.slice(0, 20) : []

  const items = rawItems
    .map(it => ({
      name: String(it?.name ?? '').slice(0, 120).trim(),
      part_no: String(it?.part_no ?? '').slice(0, 60).trim(),
      qty: Number(it?.qty) || 0,
      unit: String(it?.unit ?? '').slice(0, 20).trim() || 'pcs',
    }))
    .filter(it => it.name && it.qty > 0)
  if (!items.length) {
    return NextResponse.json({ error: 'Minimal satu item (nama + qty)' }, { status: 400 })
  }
  if (!incidentId) {
    return NextResponse.json({ error: 'Laporan terkait wajib diisi' }, { status: 400 })
  }

  // Incident context: work-order number, machine, factory → target warehouse.
  const supabase = await createClient()
  const { data: incident, error } = await supabase
    .from('incidents')
    .select('incident_no, factory_id, machine_id, factory:factories(code, name), machine:machines(machine_code, machine_name)')
    .eq('id', incidentId)
    .single()
  if (error || !incident) {
    return NextResponse.json({ error: 'Laporan tidak ditemukan' }, { status: 404 })
  }

  // Supabase types to-one joins as arrays; at runtime .single() returns objects
  const factory = incident.factory as unknown as { code: string | null; name: string | null } | null
  const machine = incident.machine as unknown as { machine_code: string | null; machine_name: string | null } | null
  const mappedWarehouse = FACTORY_TO_WAREHOUSE[factory?.code ?? ''] ?? null
  const warehouse = mappedWarehouse ?? DEFAULT_WAREHOUSE
  // Unmapped factory → the request still goes through (to the default
  // warehouse), but the note tells warehouse staff which plant it's really
  // for, so they can route/hand it over correctly.
  const noteForGudang = mappedWarehouse
    ? note
    : [`[Pabrik: ${factory?.name || factory?.code || '?'}]`, note].filter(Boolean).join(' ')

  // Idempotency guard: a double-tap, or a retry after the network dropped
  // mid-response, must not create a second request (and a second Gudang push).
  // No schema change needed — check for an identical request (same incident,
  // same user, same items) in the last 30s and treat a match as the same
  // submission, returning success without re-sending.
  //
  // Comparison must be KEY-ORDER-INSENSITIVE: jsonb does not preserve object
  // key order, so rows read back from Postgres have their keys reordered and
  // a naive JSON.stringify() equality never matches — which silently disabled
  // this whole guard. Canonicalize each item to a fixed field order first.
  const canonItems = (arr: unknown): string => {
    if (!Array.isArray(arr)) return ''
    return JSON.stringify(arr.map((it) => {
      const o = it as Record<string, unknown>
      return [String(o?.name ?? ''), String(o?.part_no ?? ''), Number(o?.qty) || 0, String(o?.unit ?? '')]
    }))
  }
  const itemsKey = canonItems(items)
  const since = new Date(Date.now() - 30_000).toISOString()
  const { data: recent } = await supabase
    .from('parts_requests')
    .select('id, items, external_ref')
    .eq('incident_id', incidentId)
    .eq('requested_by_id', user.id)
    .gte('requested_at', since)
    .order('requested_at', { ascending: false })
    .limit(5)
  const dup = (recent ?? []).find(r => canonItems(r.items) === itemsKey)
  if (dup) {
    return NextResponse.json({ ok: true, request_id: dup.external_ref ?? null, deduped: true })
  }

  // Insert the local tracking row first so its id can be handed to Gudang as
  // famms_request_id — Gudang stores it and echoes it back on later status
  // write-backs (POST /api/external/parts-requests), since it has no other
  // way to reach us again after this request/response cycle ends.
  const { data: tracked, error: trackErr } = await supabase
    .from('parts_requests')
    .insert({
      factory_id: incident.factory_id,
      incident_id: incidentId,
      machine_id: incident.machine_id,
      items,
      urgency,
      note: note || null,
      requested_by_id: user.id,
    })
    .select('id')
    .single()
  if (trackErr || !tracked) {
    return NextResponse.json({ error: 'Gagal mencatat permintaan' }, { status: 500 })
  }

  const payload = {
    famms_request_id: tracked.id,
    machine_id: machine?.machine_code || machine?.machine_name || '-',
    machine_name: machine?.machine_name || '',
    work_order: incident.incident_no,
    items,
    urgency,
    requester: user.full_name || 'FAMMS user',
    warehouse,
    note: noteForGudang,
  }

  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-famms-secret': secret },
      body: JSON.stringify(payload),
    })
  } catch {
    // AMBIGUOUS: the request may have died before reaching Gudang, or the
    // connection dropped after Gudang processed it. Deleting the local row
    // here created "ghost orders": Gudang had the order, FAMMS had nothing to
    // match its later write-back, and the user resent — duplicating the order.
    // Keep the row (Gudang holds our famms_request_id, so a write-back still
    // lands) and tell the user to check the tracker before resending.
    return NextResponse.json(
      { error: 'Tidak ada respons dari Gudang One. Permintaan MUNGKIN sudah terkirim — cek status permintaan di bawah dulu, jangan langsung kirim ulang.' },
      { status: 502 }
    )
  }

  let out: { ok?: boolean; request_id?: unknown; error?: string } | null = null
  try { out = await resp.json() } catch { out = null }

  if (!resp.ok) {
    // Gudang answered with an explicit error status — it rejected the request,
    // so removing the local row is safe (no phantom "requested" entry).
    await supabase.from('parts_requests').delete().eq('id', tracked.id)
    return NextResponse.json(
      { error: out?.error || `Gudang menolak permintaan (${resp.status})` },
      { status: 502 }
    )
  }

  // 200 with an unparseable/short body: Gudang almost certainly processed it
  // (its function returns JSON on every code path) — treat as delivered, just
  // without the external reference. The status write-back will fill in later.
  if (out?.request_id) {
    await supabase.from('parts_requests').update({ external_ref: String(out.request_id) }).eq('id', tracked.id)
  }

  return NextResponse.json({ ok: true, request_id: out?.request_id ?? null })
}
