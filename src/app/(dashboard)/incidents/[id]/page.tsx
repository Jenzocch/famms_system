import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import StatusBadge from '@/components/shared/StatusBadge'
import ActionForm from '@/components/incidents/ActionForm'
import RCAForm from '@/components/incidents/RCAForm'
import CloseIncidentButton from '@/components/incidents/CloseIncidentButton'
import { checkRCARequirement } from '@/lib/rca'
import {
  IncidentStatus, DowntimeImpact, DOWNTIME_IMPACT_LABELS,
  ActionType, ACTION_TYPE_LABELS, CompletionType, COMPLETION_TYPE_LABELS,
} from '@/types'
import { ChevronLeft, Clock, Wrench, BookOpen } from 'lucide-react'
import { format } from 'date-fns'

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: incident } = await supabase
    .from('incidents')
    .select(`
      *,
      machine:machines(machine_code, machine_name, brand, model),
      failure_code:failure_codes(code, name)
    `)
    .eq('id', id)
    .single()

  if (!incident) notFound()

  const { data: actions } = await supabase
    .from('incident_actions')
    .select('*')
    .eq('incident_id', id)
    .order('action_sequence', { ascending: true })

  const machine = incident.machine as { machine_code: string; machine_name: string; brand?: string; model?: string } | null
  const fc = incident.failure_code as { code: string; name: string } | null

  // RCA gate: when the same failure_code crossed the threshold and no RCA exists,
  // closing is blocked and the RCA form is shown.
  const rca = await checkRCARequirement(supabase, incident.failure_code_id, incident.factory_id)
  const rcaBlocked = rca.required && !rca.satisfied
  const isClosed = incident.status === 'closed'

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <Link href="/incidents" className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1">
          <ChevronLeft className="w-4 h-4" /> Kembali
        </Link>
      </div>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-mono text-lg font-bold text-gray-900">{incident.incident_no}</h1>
            <p className="text-gray-600 mt-1">
              {machine ? `${machine.machine_code} — ${machine.machine_name}` : 'Mesin?'}
            </p>
          </div>
          <StatusBadge status={incident.status as IncidentStatus} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 text-sm">
          <Field label="Failure Code" value={fc ? `${fc.code}` : '-'} sub={fc?.name} />
          <Field
            label="Dampak"
            value={incident.downtime_impact}
            sub={DOWNTIME_IMPACT_LABELS[incident.downtime_impact as DowntimeImpact]}
          />
          <Field
            label="Dilaporkan"
            value={format(new Date(incident.reported_at), 'dd MMM yyyy')}
            sub={format(new Date(incident.reported_at), 'HH:mm')}
          />
          <Field
            label="Tipe Fix"
            value={incident.completion_type
              ? COMPLETION_TYPE_LABELS[incident.completion_type as CompletionType].split(' (')[0]
              : '-'}
          />
        </div>

        {incident.remarks && (
          <div className="mt-4 text-sm text-gray-600 bg-gray-50 rounded-lg p-3">{incident.remarks}</div>
        )}
        {incident.root_cause && (
          <div className="mt-3 text-sm">
            <span className="font-medium text-gray-700">Root Cause: </span>
            <span className="text-gray-600">{incident.root_cause}</span>
          </div>
        )}
      </div>

      {/* Action timeline */}
      <div>
        <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Wrench className="w-4 h-4" /> Timeline Perbaikan ({actions?.length ?? 0})
        </h2>
        {!actions || actions.length === 0 ? (
          <p className="text-sm text-gray-400 bg-white rounded-xl border border-gray-200 p-6 text-center">
            Belum ada action. Tambah langkah perbaikan di bawah.
          </p>
        ) : (
          <ol className="relative border-l border-gray-200 ml-3 space-y-4">
            {actions.map((a) => (
              <li key={a.id} className="ml-5">
                <span className="absolute -left-2 flex items-center justify-center w-4 h-4 bg-blue-100 rounded-full ring-4 ring-white">
                  <span className="w-2 h-2 bg-blue-600 rounded-full" />
                </span>
                <div className="bg-white rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">
                      {a.action_sequence}. {ACTION_TYPE_LABELS[a.action_type as ActionType]}
                    </span>
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {format(new Date(a.performed_at), 'dd MMM HH:mm')}
                    </span>
                  </div>
                  {a.description && <p className="text-sm text-gray-600 mt-1">{a.description}</p>}
                  {a.duration_minutes ? (
                    <p className="text-xs text-gray-400 mt-1">Durasi: {a.duration_minutes} menit</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* RCA mandatory form (when triggered & not yet satisfied) */}
      {!isClosed && rcaBlocked && (
        <RCAForm failureCodeId={incident.failure_code_id} occurrenceCount={rca.occurrenceCount} />
      )}

      {/* Add action */}
      {!isClosed && <ActionForm incidentId={id} />}

      {/* Close incident */}
      {!isClosed && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <CloseIncidentButton incidentId={id} rcaBlocked={rcaBlocked} />
          {rcaBlocked && (
            <p className="text-xs text-red-600 mt-2 text-center">
              Failure code ini terjadi {rca.occurrenceCount}× dalam 90 hari — isi RCA di atas untuk dapat menutup.
            </p>
          )}
        </div>
      )}

      {/* Capture knowledge after close */}
      {isClosed && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
          <p className="text-sm text-gray-600 mb-3">Incident selesai. Dokumentasikan pembelajaran untuk tim.</p>
          <Link
            href={`/knowledge-base/new?incident=${id}`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
          >
            <BookOpen className="w-4 h-4" /> Buat Knowledge Base
          </Link>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="font-medium text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  )
}
