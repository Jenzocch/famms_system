import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Edit2, QrCode } from 'lucide-react'
import StatusBadge from '@/components/shared/StatusBadge'
import HealthScoreBadge from '@/components/shared/HealthScoreBadge'
import MachineStatsStrip from '@/components/machines/MachineStatsStrip'
import { formatDistance } from 'date-fns'
import { id } from 'date-fns/locale'

export const metadata = { title: 'Machine | FAMMS' }

export default async function MachineDetailPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!user.capabilities.viewMachines) redirect('/incidents')
  const supabase = await createClient()

  // 365 days ago, for the MTBF tile below — computed once so both the query
  // and the eventual "how many days" math agree on the same cutoff instant.
  const oneYearAgo = new Date()
  oneYearAgo.setDate(oneYearAgo.getDate() - 365)

  // All reads are keyed on params.id directly (not on each other's result),
  // so fetch them in one round trip instead of several sequential ones.
  const [{ data: machine }, { data: incidents }, { data: health }, { data: incidents365 }, { data: costs }] = await Promise.all([
    supabase
      .from('machines')
      .select('*, area:areas(name), owner:profiles(full_name), factory:factories(name)')
      .eq('id', params.id)
      .single(),
    supabase
      .from('incidents')
      .select('*, failure_code:failure_codes(code, name)')
      .eq('machine_id', params.id)
      .order('reported_at', { ascending: false })
      .limit(5),
    supabase
      .from('equipment_health_scores')
      .select('*')
      .eq('machine_id', params.id)
      .order('last_updated', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // MTBF input — every incident in the last 365 days, oldest first. Row
    // count per machine is small, so no need for a head-only count query.
    supabase
      .from('incidents')
      .select('reported_at')
      .eq('machine_id', params.id)
      .gte('reported_at', oneYearAgo.toISOString())
      .order('reported_at'),
    // Cumulative maintenance cost — summed in JS below, no .rpc needed for
    // a per-machine total this small.
    supabase
      .from('maintenance_costs')
      .select('amount')
      .eq('machine_id', params.id),
  ])

  if (!machine) redirect('/machines')

  const failureCount12mo = incidents365?.length ?? 0
  // MTBF = time span across the failures divided by the GAPS between them
  // (count - 1), not the count itself — needs at least 2 incidents to have
  // a gap to measure at all.
  let mtbfDays: number | null = null
  if (incidents365 && incidents365.length >= 2) {
    const first = new Date(incidents365[0].reported_at).getTime()
    const last = new Date(incidents365[incidents365.length - 1].reported_at).getTime()
    mtbfDays = Math.round((last - first) / (incidents365.length - 1) / (1000 * 60 * 60 * 24))
  }
  const totalMaintenanceCost = (costs ?? []).reduce((sum, c) => sum + (c.amount ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/machines">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">{machine.machine_code}</h1>
            <p className="text-sm text-gray-600">{machine.machine_name}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/machines/${machine.id}/qr`}>
            <Button variant="outline">
              <QrCode className="w-4 h-4 mr-2" />
              QR Code
            </Button>
          </Link>
          <Link href={`/machines/${machine.id}/edit`}>
            <Button>
              <Edit2 className="w-4 h-4 mr-2" />
              Edit
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase">Status</p>
              <div className="mt-1">
                <StatusBadge status={machine.status} type="machine" />
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase">Area</p>
              <p className="text-sm text-gray-900 mt-1">{machine.area?.name || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase">Pabrik</p>
              <p className="text-sm text-gray-900 mt-1">{machine.factory?.name || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase">PIC</p>
              <p className="text-sm text-gray-900 mt-1">{machine.owner?.full_name || '—'}</p>
            </div>
          </div>

          <hr />

          <div className="space-y-3">
            {machine.brand && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Brand</p>
                <p className="text-sm text-gray-900">{machine.brand}</p>
              </div>
            )}
            {machine.model && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Model</p>
                <p className="text-sm text-gray-900">{machine.model}</p>
              </div>
            )}
            {machine.serial_number && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">No. Seri</p>
                <p className="text-sm text-gray-900 font-mono">{machine.serial_number}</p>
              </div>
            )}
            {machine.purchase_date && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Tanggal Pembelian</p>
                <p className="text-sm text-gray-900">{machine.purchase_date}</p>
              </div>
            )}
            {machine.install_date && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Tanggal Instalasi</p>
                <p className="text-sm text-gray-900">{machine.install_date}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase">Siklus PM</p>
              <p className="text-sm text-gray-900">{machine.maintenance_cycle} hari</p>
            </div>
            {machine.remarks && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase">Catatan</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{machine.remarks}</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {health && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Health Score</p>
              <HealthScoreBadge score={health.score} />
              <div className="mt-3 space-y-1 text-xs text-gray-500">
                <p>Failure 90d: {health.failure_count_90d ?? 0}</p>
                <p>Downtime 90d: {health.downtime_hours_90d ?? 0} jam</p>
                <p>Repeat failure: {health.repeat_failure_count ?? 0}</p>
                <p>PM terlambat: {health.pm_overdue_count ?? 0}</p>
              </div>
            </div>
          )}
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl border border-blue-200 p-4">
            <p className="text-xs font-semibold text-blue-600 uppercase">Dibuat</p>
            <p className="text-sm text-blue-900 mt-1">
              {formatDistance(new Date(machine.created_at), new Date(), {
                addSuffix: true,
                locale: id,
              })}
            </p>
          </div>
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl border border-purple-200 p-4">
            <p className="text-xs font-semibold text-purple-600 uppercase">Diperbarui</p>
            <p className="text-sm text-purple-900 mt-1">
              {formatDistance(new Date(machine.updated_at), new Date(), {
                addSuffix: true,
                locale: id,
              })}
            </p>
          </div>
          <Link href={`/incidents?machine=${machine.id}`}>
            <Button variant="outline" className="w-full">
              Lihat Incidents
            </Button>
          </Link>
        </div>
      </div>

      <MachineStatsStrip
        failureCount12mo={failureCount12mo}
        mtbfDays={mtbfDays}
        totalCost={totalMaintenanceCost}
      />

      {incidents && incidents.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Incidents Terbaru</h2>
          <div className="space-y-2">
            {incidents.map((inc) => (
              <Link key={inc.id} href={`/incidents/${inc.id}`}>
                <div className="p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-semibold text-gray-900">{inc.incident_no}</p>
                    <StatusBadge status={inc.status} type="incident" />
                  </div>
                  <p className="text-sm text-gray-600">{inc.failure_code?.name}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {formatDistance(new Date(inc.reported_at), new Date(), {
                      addSuffix: true,
                      locale: id,
                    })}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
