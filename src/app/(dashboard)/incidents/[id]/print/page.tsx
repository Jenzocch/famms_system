import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser, PERMISSIONS } from '@/lib/auth'
import { notFound } from 'next/navigation'
import PrintReport, { type RelatedIncidentRow, type ReportUpdateRow, type PartsRequestRow, type CostRow } from '@/components/incidents/PrintReport'
import QRCode from 'qrcode'

export const metadata = { title: '工單檢討報告 | FAMMS' }

function parsePhotos(raw: unknown): string[] {
  if (!raw || typeof raw !== 'string') return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export default async function IncidentPrintPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await getCurrentUser()
  const supabase = await createClient()

  const { data: incident } = await supabase
    .from('incidents')
    .select(`
      *,
      machine:machines(machine_code, machine_name),
      factory:factories(name, code)
    `)
    .eq('id', id)
    .single()

  if (!incident) notFound()

  // Same access guard as the detail page: technicians may only print
  // orders assigned to them or that they reported.
  if (user && !PERMISSIONS.boardFull(user.role)) {
    const assignedIds: string[] = incident.assigned_user_ids ?? []
    const isReporter = incident.reported_by_id === user.id
    if (!assignedIds.includes(user.id) && !isReporter) notFound()
  }

  // Reads that only depend on the incident id can run in parallel.
  const [
    { data: updates },
    { data: partsRequests },
    { data: costRows },
    { data: kb },
  ] = await Promise.all([
    supabase
      .from('incident_updates')
      .select('*')
      .eq('incident_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('parts_requests')
      .select('id, items, urgency, status, requested_at')
      .eq('incident_id', id)
      .order('requested_at', { ascending: true }),
    supabase
      .from('maintenance_costs')
      .select('cost_type, amount')
      .eq('incident_id', id),
    supabase
      .from('knowledge_base')
      .select('repair_method')
      .eq('incident_id', id)
      .maybeSingle(),
  ])

  // Who closed it — closed_by_id is a plain FK column on incidents (no join
  // alias set up in the schema), so resolve the name with a targeted lookup.
  let closedByName: string | null = null
  if (incident.closed_by_id) {
    const { data } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', incident.closed_by_id)
      .single()
    closedByName = data?.full_name ?? null
  }

  // Repeat-failure context: other incidents on the same machine in the last
  // 90 days (newest first), so a reviewer can spot a pattern at a glance.
  let relatedIncidents: RelatedIncidentRow[] = []
  if (incident.machine_id) {
    // Server Component: runs once per request on the server, not on a client
    // re-render, so Date.now() here isn't the hydration/purity hazard the
    // rule is guarding against.
    // eslint-disable-next-line react-hooks/purity
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    const { data } = await supabase
      .from('incidents')
      .select('id, incident_no, title, reported_at, status, completion_type')
      .eq('machine_id', incident.machine_id)
      .neq('id', id)
      .gte('reported_at', ninetyDaysAgo)
      .order('reported_at', { ascending: false })
      .limit(10)
    relatedIncidents = data ?? []
  }

  // Photos attached to the ORIGINAL report live directly under
  // incident-photos/{id}/ with no DB record — same storage-list pattern as
  // the detail page. Best-effort: a storage hiccup must not break printing.
  let reportPhotos: string[] = []
  try {
    const { data: files } = await createAdminClient()
      .storage.from('incident-photos')
      .list(id, { limit: 20 })
    reportPhotos = (files ?? [])
      .filter(f => f.id && !f.name.startsWith('.'))
      .map(f => `${id}/${f.name}`)
  } catch { /* storage unavailable / key missing — just skip the gallery */ }

  // QR code linking back to the live incident — server-generated so it
  // renders in the printed/PDF output with no client round-trip. Skipped
  // silently (no crash) if the public app URL isn't configured.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  let qrDataUrl: string | null = null
  if (appUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(`${appUrl}/incidents/${id}`, {
        errorCorrectionLevel: 'M',
        width: 96,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      })
    } catch { /* best effort */ }
  }

  const machine = incident.machine as { machine_code: string | null; machine_name: string } | null
  const factory = incident.factory as { name: string; code: string | null } | null
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''

  return (
    <PrintReport
      incident={{
        id: incident.id,
        incident_no: incident.incident_no,
        title: incident.title,
        description: incident.description,
        incident_type: incident.incident_type,
        status: incident.status,
        downtime_impact: incident.downtime_impact,
        reporter_name: incident.reporter_name,
        reported_at: incident.reported_at,
        accepted_at: incident.accepted_at,
        closed_at: incident.closed_at,
        due_date: incident.due_date,
        root_cause: incident.root_cause,
        completion_type: incident.completion_type,
        location_note: incident.location_note,
      }}
      machine={machine}
      factory={factory}
      closedByName={closedByName}
      repairMethod={kb?.repair_method ?? null}
      updates={(updates ?? []).map((u: ReportUpdateRow & { photos: unknown }) => ({
        ...u,
        photos: parsePhotos(u.photos),
      }))}
      reportPhotos={reportPhotos}
      partsRequests={(partsRequests ?? []) as PartsRequestRow[]}
      costs={(costRows ?? []) as CostRow[]}
      relatedIncidents={relatedIncidents}
      supabaseUrl={supabaseUrl}
      qrDataUrl={qrDataUrl}
    />
  )
}
