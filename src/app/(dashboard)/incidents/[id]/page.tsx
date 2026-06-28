import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import ProgressUpdate from '@/components/incidents/ProgressUpdate'
import AssignForm from '@/components/incidents/AssignForm'
import IncidentActions from '@/components/incidents/IncidentActions'
import ImageViewer from '@/components/shared/ImageViewer'
import AuditTrail from '@/components/incidents/AuditTrail'
import { IncidentStatus } from '@/types'
import {
  ISSUE_TYPE_LABELS, URGENCY_FROM_IMPACT, STATUS_ZH, STATUS_ZH_COLOR,
} from '@/lib/incident-display'
import { ChevronLeft, Clock, User, UserCheck, CalendarClock } from 'lucide-react'
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
      <Link href="/incidents" className="text-sm text-gray-500 inline-flex items-center gap-1">
        <ChevronLeft className="w-4 h-4" /> 返回看板
      </Link>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_ZH_COLOR[status]}`}>
            {STATUS_ZH[status]}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${urgency.color}`}>
            {urgency.label}
          </span>
          <span className="text-xs text-gray-400 font-mono ml-auto">{incident.incident_no}</span>
        </div>

        <h1 className="text-lg font-bold text-gray-900 mt-2">
          {incident.title || ISSUE_TYPE_LABELS[incident.incident_type] || '問題'}
        </h1>

        <div className="mt-2 space-y-1 text-sm text-gray-600">
          <p>{ISSUE_TYPE_LABELS[incident.incident_type] || incident.incident_type}</p>
          <p>
            📍 {factory?.name || '?'}
            {machine ? ` · ${machine.machine_code ? `[${machine.machine_code}] ` : ''}${machine.machine_name}` : ''}
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
              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ${
                !isClosed && new Date(incident.due_date) < new Date(new Date().toDateString())
                  ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-600'
              }`}>
                <CalendarClock className="w-3.5 h-3.5" />
                預計 {format(new Date(incident.due_date), 'yyyy-MM-dd')}
                {!isClosed && new Date(incident.due_date) < new Date(new Date().toDateString()) ? ' (逾期)' : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Progress timeline */}
      <div>
        <h2 className="font-semibold text-gray-900 mb-2 text-sm">處理紀錄 ({updateRows.length})</h2>
        {updateRows.length === 0 ? (
          <p className="text-sm text-gray-400 bg-white rounded-xl border border-gray-200 p-5 text-center">
            尚無處理紀錄
          </p>
        ) : (
          <ol className="relative border-l-2 border-gray-100 ml-2 space-y-3">
            {updateRows.map(u => {
              const photos = parsePhotos(u.photos)
              return (
                <li key={u.id} className="ml-4">
                  <span className="absolute -left-[7px] w-3 h-3 bg-blue-500 rounded-full ring-4 ring-white" />
                  <div className="bg-white rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-800">
                        {u.updated_by || '維修人員'}
                      </span>
                      {u.new_status && (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_ZH_COLOR[u.new_status as IncidentStatus] || 'bg-gray-100 text-gray-600'}`}>
                          → {STATUS_ZH[u.new_status as IncidentStatus] || u.new_status}
                        </span>
                      )}
                    </div>
                    {u.note && <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{u.note}</p>}
                    {photos.length > 0 && (
                      <div className="mt-2">
                        <ImageViewer paths={photos} supabaseUrl={supabaseUrl} />
                      </div>
                    )}
                    <p className="text-xs text-gray-400 mt-1.5">
                      {format(new Date(u.created_at), 'MM-dd HH:mm')}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>

      {/* Update form */}
      {!isClosed ? (
        <ProgressUpdate
          incidentId={id}
          currentStatus={status}
          userRole={user?.role}
          userName={user?.full_name}
        />
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center text-sm text-green-700">
          ✅ 此案件已結案
          {incident.closed_at && ` · ${format(new Date(incident.closed_at), 'yyyy-MM-dd HH:mm')}`}
        </div>
      )}

      {/* Assignment (派工) */}
      {!isClosed && (
        <AssignForm
          incidentId={id}
          assignedTo={incident.assigned_to}
          assignedDept={incident.assigned_dept}
          dueDate={incident.due_date}
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
