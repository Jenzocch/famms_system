import { createClient } from '@/lib/supabase/client'
import { logAuditEvent } from '@/lib/audit'

type SupabaseClient = ReturnType<typeof createClient>

export interface SubmitIncidentReportInput {
  factoryId: string
  incidentType: string
  machineId: string | null
  title: string
  description: string
  reporterName: string
  impactCode: 'A' | 'C' | 'D'
  dueDate: string
  locationNote: string
  photos: File[]
  userId: string | null
  // Generated ONCE by the caller when the form mounts (not regenerated on
  // retry) — lets a resubmit after a network drop be recognized as "the same
  // report" instead of creating a duplicate. See the idempotency check below.
  clientRequestId?: string
}

// Creates an incident end-to-end: unique incident_no (retry on collision),
// insert, best-effort photo upload, audit trail, Telegram notify. Any of the
// post-insert steps failing must not undo the incident itself — the case is
// already real to the reporter the moment this function returns.
export async function submitIncidentReport(
  supabase: SupabaseClient,
  input: SubmitIncidentReportInput
): Promise<{ id: string; incident_no: string; photoUploadFailed: boolean }> {
  const { data: { user } } = await supabase.auth.getUser()

  // Idempotency short-circuit: on a flaky-signal retry (same clientRequestId,
  // e.g. the user hit submit again after an ambiguous timeout), a matching
  // row means the FIRST attempt actually went through — return it as-is
  // rather than creating a second incident. Photos/audit/notify from that
  // first attempt already happened; do not repeat them.
  if (input.clientRequestId) {
    const { data: existing } = await supabase
      .from('incidents')
      .select('id, incident_no')
      .eq('client_request_id', input.clientRequestId)
      .maybeSingle()
    if (existing) {
      return { id: existing.id, incident_no: existing.incident_no, photoUploadFailed: false }
    }
  }

  const now = new Date()
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const { count } = await supabase
    .from('incidents')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString())

  const insertPayload: Record<string, unknown> = {
    factory_id: input.factoryId,
    incident_type: input.incidentType,
    machine_id: input.machineId,
    title: input.title,
    description: input.description,
    reporter_name: input.reporterName || null,
    downtime_impact: input.impactCode,
    due_date: input.dueDate,
    status: 'reported',
    reported_by_id: user?.id ?? null,
  }
  // Only send location_note when actually filled, so reporting still works on
  // databases where migration_incident_location_note.sql hasn't run yet (an
  // unknown column would otherwise fail the whole insert).
  const trimmedLocation = input.locationNote.trim()
  if (trimmedLocation) insertPayload.location_note = trimmedLocation

  // Same backward-compatibility need as location_note: only send this on
  // databases where the client_request_id column exists yet (added via
  // SYNC_SCHEMA_LATEST.sql). Tracked separately so a 42703 "column does not
  // exist" can drop just this field and retry, without losing the incident_no
  // collision-retry logic below.
  let sendClientRequestId = !!input.clientRequestId

  // The number is "today's count + 1". Two people reporting at once would
  // compute the same value, so on a unique-violation (23505 — once the
  // incidents_incident_no_key constraint is in place) bump the sequence and
  // retry. Without the DB constraint this still works; it just can't catch a
  // true simultaneous collision.
  let incident: { id: string; incident_no: string } | null = null
  let seq = (count ?? 0) + 1
  for (let attempt = 0; attempt < 6; attempt++) {
    const incident_no = `FIT-${ym}-${String(seq).padStart(3, '0')}`
    const payload: Record<string, unknown> = { ...insertPayload, incident_no }
    if (sendClientRequestId) payload.client_request_id = input.clientRequestId
    const { data, error } = await supabase
      .from('incidents')
      .insert(payload)
      .select('*')
      .single()
    if (!error) { incident = data; break }
    if (error.code === '42703' && sendClientRequestId) {
      // Column doesn't exist on this database yet — drop it and retry the
      // SAME sequence number (this isn't an incident_no collision).
      sendClientRequestId = false
      continue
    }
    if (error.code === '23505') {
      // Two distinct unique constraints can fire here — tell them apart:
      //  - client_request_id UNIQUE: a parallel duplicate of THIS submission
      //    (double-tap racing past the top-of-function check) already
      //    inserted. Bumping incident_no forever can't fix that — every
      //    retry hits the same conflict, and the user got a raw Postgres
      //    error. Fetch the winner and return it as our own success.
      //  - incident_no collision: two people reporting at once — bump the
      //    sequence and retry as before.
      if (sendClientRequestId && `${error.message} ${error.details ?? ''}`.includes('client_request_id')) {
        const { data: winner } = await supabase
          .from('incidents')
          .select('id, incident_no')
          .eq('client_request_id', input.clientRequestId!)
          .maybeSingle()
        if (winner) {
          return { id: winner.id, incident_no: winner.incident_no, photoUploadFailed: false }
        }
      }
      seq++; continue
    }
    throw error
  }
  // Exhausted retries: surface a human message, never the raw unique-violation.
  if (!incident) throw new Error('無法產生不重複的工單編號，請重試 / Gagal membuat nomor laporan, coba lagi')
  const incident_no = incident.incident_no

  // Upload photos if any. Best-effort: the incident is already saved, so a
  // storage problem (missing bucket / permissions) must not fail the report.
  let photoUploadFailed = false
  if (input.photos.length > 0) {
    try {
      for (const [i, photo] of input.photos.entries()) {
        const ext = photo.name.split('.').pop()
        // -{i} disambiguates same-millisecond uploads (same convention as
        // ProgressUpdate) — a name collision failed the whole batch.
        const path = `${incident.id}/${Date.now()}-${i}.${ext}`
        const { error: upErr } = await supabase.storage.from('incident-photos').upload(path, photo)
        if (upErr) throw upErr
      }
    } catch (photoErr) {
      console.error('Photo upload failed:', photoErr)
      photoUploadFailed = true
    }
  }

  await logAuditEvent(supabase, {
    userId: user?.id ?? null,
    userName: input.reporterName || null,
    actionType: 'create',
    resourceType: 'incident',
    resourceId: incident.id,
    newValue: { incident_no, title: input.title, incident_type: input.incidentType },
    changeSummary: `工單已建立：${incident_no}`,
    factoryId: input.factoryId || undefined,
  })

  await fetch('/api/incidents/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ incidentId: incident.id }),
  }).catch(() => {})

  return { id: incident.id, incident_no, photoUploadFailed }
}
