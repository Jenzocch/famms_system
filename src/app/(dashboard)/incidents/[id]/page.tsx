import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, PERMISSIONS } from '@/lib/auth'
import { notFound } from 'next/navigation'
import ProgressUpdate from '@/components/incidents/ProgressUpdate'
import ProgressTimeline from '@/components/incidents/ProgressTimeline'
import StatusChip from '@/components/incidents/StatusChip'
import { BackLink, DueDateChip, ClosedBanner } from '@/components/incidents/IncidentDetailChrome'
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
      factory:factories(name)
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

  const machine = incident.machine as { machine_code: string | null; machine_name: string } | null
  const factory = incident.factory as { name: string } | null
  const status = incident.status as IncidentStatus
  const urgency = URGENCY_FROM_IMPACT[incident.downtime_impact as 'A' | 'B' | 'C' | 'D']
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const updateRows = (updates ?? []) as UpdateRow[]
  const isClosed = status === 'closed'

  return (
    <div className="space-y-4">
      <BackLink />

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusChip status={status} />
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${urgency.color}`}>
            {urgency.label}
          </span>
          <span className="text-xs text-gray-400 font-mono ml-auto">{incident.incident_no}</span>
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

      {/* Progress timeline (client component → labels follow app language) */}
      <ProgressTimeline
        rows={updateRows.map(u => ({ ...u, photos: parsePhotos(u.photos) }))}
        supabaseUrl={supabaseUrl}
      />

      {/* Update form */}
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

      {/* Assignment (派工) */}
      {!isClosed && (
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
      )}

      {/* Edit / Delete */}
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
      />

      {/* Audit Trail - Operation History */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <AuditTrail resourceId={id} resourceType="incident" />
      </div>
    </div>
  )
}
