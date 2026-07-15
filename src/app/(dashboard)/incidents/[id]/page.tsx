import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser, PERMISSIONS } from '@/lib/auth'
import { notFound } from 'next/navigation'
import ImageViewer from '@/components/shared/ImageViewer'
import ProgressUpdate from '@/components/incidents/ProgressUpdate'
import ProgressTimeline from '@/components/incidents/ProgressTimeline'
import WorkflowProgress from '@/components/incidents/WorkflowProgress'
import RemindButton from '@/components/incidents/RemindButton'
import GudangRequest from '@/components/incidents/GudangRequest'
import PartsRequestTracker from '@/components/incidents/PartsRequestTracker'
import PastRecordsPanel from '@/components/incidents/report/PastRecordsPanel'
import type { PastIncident, KBMatch } from '@/lib/hooks/usePastRecords'
import StatusChip from '@/components/incidents/StatusChip'
import { BackLink, UrgencyChip, DueDateChip, ClosedBanner, CollapsibleSection, PrintReportLink, YourTurnBadge } from '@/components/incidents/IncidentDetailChrome'
import AssignForm from '@/components/incidents/AssignForm'
import IncidentActions from '@/components/incidents/IncidentActions'
import AuditTrail from '@/components/incidents/AuditTrail'
import IncidentTypeText from '@/components/incidents/IncidentTypeText'
import { IncidentStatus } from '@/types'
import { URGENCY_FROM_IMPACT } from '@/lib/incident-display'
import { Clock, User, UserCheck } from 'lucide-react'
import { format } from 'date-fns'

interface UpdateRow {
  id: string
  new_status: string | null
  note: string | null
  updated_by: string | null
  photos: string | null
  created_at: string
}

function parsePhotos(raw: unknown): string[] {
  if (!raw || typeof raw !== 'string') return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export default async function IncidentDetailPage({
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

  // Technicians (no full-board access) may open cases assigned to them or that
  // they reported.
  if (user && !PERMISSIONS.boardFull(user.role)) {
    const assignedIds: string[] = incident.assigned_user_ids ?? []
    const isReporter = incident.reported_by_id === user.id
    if (!assignedIds.includes(user.id) && !isReporter) notFound()
  }

  const { data: updates } = await supabase
    .from('incident_updates')
    .select('*')
    .eq('incident_id', id)
    .order('created_at', { ascending: false })

  const { data: partsRequests } = await supabase
    .from('parts_requests')
    .select('id, items, urgency, status, requested_at')
    .eq('incident_id', id)
    .order('requested_at', { ascending: false })

  // Past experience on the same machine — so the assignee sees last time's
  // fix before heading to the machine. Open cases only; a closed case no
  // longer needs the hint. KB entries from this incident itself are excluded
  // (they'd be circular).
  let pastIncidents: PastIncident[] = []
  let kbEntries: KBMatch[] = []
  if (incident.machine_id && incident.status !== 'closed') {
    const [pi, kb] = await Promise.all([
      supabase
        .from('incidents')
        .select('id, incident_no, title, status, reported_at')
        .eq('machine_id', incident.machine_id)
        .neq('id', id)
        .order('reported_at', { ascending: false })
        .limit(3),
      supabase
        .from('knowledge_base')
        .select('id, problem, repair_method, incident:incidents!inner(machine_id)')
        .eq('incident.machine_id', incident.machine_id)
        .neq('incident_id', id)
        .order('created_at', { ascending: false })
        .limit(3),
    ])
    pastIncidents = (pi.data as PastIncident[]) ?? []
    kbEntries = ((kb.data ?? []) as unknown as KBMatch[]).map(({ id: kbId, problem, repair_method }) => ({ id: kbId, problem, repair_method }))
  }

  // Photos attached to the ORIGINAL report live directly under
  // incident-photos/{id}/ with no DB record (progress-update photos go to the
  // updates/ subfolder and are tracked on their update rows), so the only way
  // to show them is to list the storage folder. Admin client: storage.list is
  // gated by storage RLS even on public buckets. Best-effort — a storage
  // hiccup must not break the page.
  let reportPhotos: string[] = []
  try {
    const { data: files } = await createAdminClient()
      .storage.from('incident-photos')
      .list(id, { limit: 20 })
    reportPhotos = (files ?? [])
      .filter(f => f.id && !f.name.startsWith('.'))
      .map(f => `${id}/${f.name}`)
  } catch { /* storage unavailable / key missing — just skip the gallery */ }

  const machine = incident.machine as { machine_code: string | null; machine_name: string } | null
  const factory = incident.factory as { name: string; code: string | null } | null
  const status = incident.status as IncidentStatus
  const urgency = URGENCY_FROM_IMPACT[incident.downtime_impact as 'A' | 'B' | 'C' | 'D']
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const updateRows = (updates ?? []) as UpdateRow[]
  const isClosed = status === 'closed'

  // "Your turn" emphasis (Part 6): highlight whichever section is THIS user's
  // actual next action right now, vs. the other still-relevant-but-not-urgent
  // section. A fresh/unowned case needs an owner before progress updates make
  // sense (assign's turn); every other open status is the assignee's turn to
  // log progress — including observation+supervisor, since closing happens
  // via ProgressUpdate's own close flow (there's no separate close section on
  // this page). Closed cases get no emphasis anywhere.
  const canAssign = user ? PERMISSIONS.assignIncident(user.role) : false
  const assignIsYourTurn = status === 'reported' && canAssign
  const updateIsYourTurn = !isClosed && status !== 'reported'

  // ---- Build each section once, then arrange them below. ----------------
  // At `xl:` the page splits into a work column (the case story + the action)
  // and a sticky management rail (AssignForm/RemindButton/GudangRequest/
  // PartsRequestTracker) — see the grid below. Below `xl:` it's one column,
  // ordered by what the viewer most likely needs next for this status (a
  // fresh, unowned case needs an owner before progress updates make sense;
  // once assigned, the technician's main job is logging progress).
  //
  // `xl:col-start-1` / `xl:col-start-2` place each piece in its column
  // regardless of where it sits in the (status-dependent) mobile order below;
  // this is plain CSS Grid column placement, not an `order-*` reorder hack —
  // the DOM order below still matches the real mobile reading order.

  const headerCard = (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <StatusChip status={status} />
        <UrgencyChip impact={incident.downtime_impact} color={urgency.color} fallbackLabel={urgency.label} />
        <span className="text-sm text-gray-800 font-mono font-semibold ml-auto bg-gray-100 px-2 py-0.5 rounded">{incident.incident_no}</span>
      </div>

      <h1 className="text-lg font-bold text-gray-900 mt-2">
        {incident.title || <IncidentTypeText code={incident.incident_type} problemFallback />}
      </h1>

      <div className="mt-2 space-y-1 text-sm text-gray-600">
        <p><IncidentTypeText code={incident.incident_type} /></p>
        <p>
          📍 {factory?.name || '?'}
          {machine ? ` · ${machine.machine_code ? `[${machine.machine_code}] ` : ''}${machine.machine_name}` : ''}
          {incident.location_note ? ` · ${incident.location_note}` : ''}
        </p>
        {incident.reporter_name && (
          <p className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> {incident.reporter_name}</p>
        )}
        <p className="flex items-center gap-1 text-gray-400">
          <Clock className="w-3.5 h-3.5" /> {format(new Date(incident.reported_at), 'yyyy-MM-dd HH:mm')}
        </p>
      </div>

      {incident.description && (
        <div className="mt-3 text-sm text-gray-700 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">
          {incident.description}
        </div>
      )}

      {/* Photos attached to the original report */}
      {reportPhotos.length > 0 && (
        <div className="mt-3">
          <ImageViewer paths={reportPhotos} supabaseUrl={supabaseUrl} />
        </div>
      )}

      {(incident.assigned_to || incident.due_date) && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {incident.assigned_to && (
            <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-1 rounded-full">
              <UserCheck className="w-3.5 h-3.5" />
              {incident.assigned_to}{incident.assigned_dept ? ` · ${incident.assigned_dept}` : ''}
            </span>
          )}
          {incident.due_date && (
            <DueDateChip dueDate={incident.due_date} isClosed={isClosed} />
          )}
        </div>
      )}
    </div>
  )

  // Header + workflow progress bar (with its role-aware "what to do next"
  // hint) as ONE grid child: as separate grid rows, a tall right rail
  // stretched row 1 and left a half-page gap between the header and the
  // progress bar on desktop. Grouped, they always sit flush together at the
  // top of the left column.
  const headerAndProgressEl = (
    <div key="headerProgress" className="space-y-4 xl:col-start-1">
      {headerCard}
      <WorkflowProgress status={status} userRole={user?.role} />
    </div>
  )

  const progressOrClosedEl = (
    <div
      key="progressOrClosed"
      id="section-update"
      className={`relative xl:col-start-1 ${updateIsYourTurn ? 'rounded-xl ring-2 ring-blue-100' : ''}`}
    >
      {updateIsYourTurn && <YourTurnBadge />}
      {!isClosed ? (
        <ProgressUpdate
          incidentId={id}
          currentStatus={status}
          userRole={user?.role}
          userName={user?.full_name}
        />
      ) : (
        <ClosedBanner closedAt={incident.closed_at} />
      )}
    </div>
  )

  const timelineEl = (
    <div key="timeline" className="xl:col-start-1">
      <ProgressTimeline
        rows={updateRows.map(u => ({ ...u, photos: parsePhotos(u.photos) }))}
        supabaseUrl={supabaseUrl}
      />
    </div>
  )

  // Same-machine history + KB hits (fetched above; empty on closed cases).
  // null when there's nothing — an empty wrapper would still eat a space-y
  // gap on mobile.
  const pastRecordsEl = (pastIncidents.length > 0 || kbEntries.length > 0) ? (
    <div key="pastRecords" className="xl:col-start-1">
      <PastRecordsPanel pastIncidents={pastIncidents} kbEntries={kbEntries} />
    </div>
  ) : null

  const manageEl = (
    <div key="manage" className="xl:col-start-1">
      <CollapsibleSection titleKey="incidentDetail.manageSection" fallback="編輯 / 刪除工單">
        <IncidentActions
          incidentId={id}
          title={incident.title}
          description={incident.description}
          incidentType={incident.incident_type}
          impact={incident.downtime_impact}
          dueDate={incident.due_date}
          userRole={user?.role}
          userName={user?.full_name}
          factoryId={incident.factory_id}
          machineId={incident.machine_id}
          locationNote={incident.location_note}
        />
      </CollapsibleSection>
    </div>
  )

  const auditEl = (
    <div key="audit" className="xl:col-start-1">
      <CollapsibleSection
        titleKey="audit.heading"
        fallback="操作歷史"
        hintKey="audit.sectionHint"
        hintFallback="誰在何時改了什麼"
      >
        <AuditTrail resourceId={id} resourceType="incident" showHeading={false} />
      </CollapsibleSection>
    </div>
  )

  // Assignment — always the top of the management rail on desktop. On mobile,
  // a fresh/unowned case (status === 'reported') needs an owner before
  // progress updates make sense, so it's placed earlier in that one case (see
  // the `order` arrays below); every other status keeps it with the rest of
  // the rail, right after the timeline.
  const assignFormEl = (
    <div
      key="assign"
      id="section-assign"
      className={`relative xl:col-start-2 xl:[grid-row:1] xl:sticky xl:top-4 ${assignIsYourTurn ? 'rounded-xl ring-2 ring-blue-100' : ''}`}
    >
      {assignIsYourTurn && <YourTurnBadge />}
      <AssignForm
        incidentId={id}
        assignedTo={incident.assigned_to}
        assignedDept={incident.assigned_dept}
        assignedUserIds={incident.assigned_user_ids}
        dueDate={incident.due_date}
        factoryId={incident.factory_id}
        userRole={user?.role}
        userName={user?.full_name}
      />
    </div>
  )

  // Remaining management-rail pieces: nudge (Telegram), Gudang One parts
  // request, and the read-only parts-request tracker — always in this order,
  // always right after AssignForm.
  // NOT sticky: AssignForm above it is sticky at the same top offset, and two
  // stacked sticky siblings pin to the same spot — this block slid up OVER the
  // assign form while scrolling, hiding the assignee picker entirely.
  const railRestEl = (
    <div key="railRest" className="space-y-4 xl:col-start-2 xl:[grid-row:2/-1]">
      {!isClosed && user && PERMISSIONS.remindProgress(user.role) && (
        <RemindButton incidentId={id} />
      )}
      {!isClosed && user && <GudangRequest incidentId={id} />}
      <PartsRequestTracker requests={partsRequests ?? []} incidentClosed={isClosed} />
    </div>
  )

  // Single flat order — this is the real mobile reading/DOM order; the grid
  // above just repositions the two rail pieces into column 2 at `xl:`.
  const order = status === 'reported'
    ? [headerAndProgressEl, assignFormEl, pastRecordsEl, progressOrClosedEl, timelineEl, railRestEl, manageEl, auditEl]
    : [headerAndProgressEl, pastRecordsEl, progressOrClosedEl, timelineEl, assignFormEl, railRestEl, manageEl, auditEl]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <BackLink />
        <PrintReportLink incidentId={id} />
      </div>

      <div className="space-y-4 xl:space-y-0 xl:grid xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-6 xl:items-start">
        {order}
      </div>
    </div>
  )
}
