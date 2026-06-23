import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Plus, AlertCircle, Activity, TrendingDown, BarChart3, Zap, Clock } from 'lucide-react'
import {
  calcResponseTime, calcRepairTime, calcDowntimeHours, calcFirstFixRate,
  calcRepeatFailureRate, calcPMCompliance, summarizeIncidents
} from '@/lib/kpi'
import FailureDistributionChart from '@/components/dashboard/FailureDistributionChart'
import IncidentStatusChart from '@/components/dashboard/IncidentStatusChart'
import EquipmentHealthChart from '@/components/dashboard/EquipmentHealthChart'
import RecalcHealthButton from '@/components/dashboard/RecalcHealthButton'
import { INCIDENT_STATUS_COLORS } from '@/types'
import { formatRupiah } from '@/lib/constants'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, factory_id')
    .eq('id', user.id)
    .single()

  // Load all data for the factory
  const [
    { data: incidents },
    { data: rawActions },
    { data: relations },
    { data: machines },
    { data: pmRecords },
    { data: costs },
    { data: healthScores },
  ] = await Promise.all([
    supabase
      .from('incidents')
      .select('*, failure_code:failure_codes(code, name)')
      .eq('factory_id', profile?.factory_id)
      .order('created_at', { ascending: false })
      .limit(1000),
    // incident_actions has no factory_id — embed the incident to scope client-side
    supabase
      .from('incident_actions')
      .select('*, incident:incidents(id, factory_id)'),
    supabase
      .from('incident_relations')
      .select('*'),
    supabase
      .from('machines')
      .select('*')
      .eq('factory_id', profile?.factory_id),
    supabase
      .from('pm_records')
      .select('*'),
    supabase
      .from('maintenance_costs')
      .select('*')
      .eq('factory_id', profile?.factory_id),
    supabase
      .from('equipment_health_scores')
      .select('*, machine:machines(machine_code, factory_id)')
      .order('last_updated', { ascending: false }),
  ])

  // Scope actions to this factory via embedded incident
  const actions = (rawActions ?? []).filter(
    (a: any) => a.incident?.factory_id === profile?.factory_id
  )

  // KPI calculations
  const openIncidents = incidents?.filter(i => !['closed'].includes(i.status)).length || 0
  const newToday = incidents?.filter(i => {
    const today = new Date().toISOString().split('T')[0]
    return i.created_at.startsWith(today)
  }).length || 0
  const repairing = machines?.filter(m => m.status === 'repairing').length || 0

  const responseTime = calcResponseTime(incidents ?? [])
  const repairTime = calcRepairTime(incidents ?? [], actions ?? [])
  const downtime = calcDowntimeHours(actions ?? [])
  const firstFixRate = calcFirstFixRate(incidents ?? [])
  const repeatRate = calcRepeatFailureRate(incidents ?? [], relations ?? [])
  const pmCompliance = calcPMCompliance(pmRecords ?? [])
  const incidentSummary = summarizeIncidents(incidents ?? [])

  // Total maintenance costs
  const totalCost = (costs ?? []).reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0)

  // Failure distribution (by failure_code)
  const failureDistribution = (incidents ?? []).reduce((acc: any, i) => {
    const key = i.failure_code?.name || 'Unknown'
    const existing = acc.find((x: any) => x.name === key)
    if (existing) existing.count += 1
    else acc.push({ name: key, count: 1 })
    return acc
  }, [])

  // Incident status distribution for pie chart
  const statusDistData = [
    { name: 'Dilaporkan', value: incidentSummary.reported, color: INCIDENT_STATUS_COLORS.reported.split(' ')[0].replace('bg-', '#').substring(0, 7) || '#3b82f6' },
    { name: 'Diterima', value: incidentSummary.accepted, color: '#3b82f6' },
    { name: 'Analisa', value: incidentSummary.analyzing, color: '#a855f7' },
    { name: 'Perbaikan', value: incidentSummary.repairing, color: '#f97316' },
    { name: 'Testing', value: incidentSummary.testing, color: '#6366f1' },
    { name: 'Observasi', value: incidentSummary.observation, color: '#14b8a6' },
    { name: 'Selesai', value: incidentSummary.closed, color: '#10b981' },
  ]

  // Machine health — real scores from equipment_health_scores (latest per machine,
  // scoped to this factory). Empty until "Hitung Ulang" is run.
  const machineHealth = (healthScores ?? [])
    .filter((h: any) => h.machine?.factory_id === profile?.factory_id)
    .map((h: any) => ({
      machine_code: h.machine?.machine_code ?? '—',
      score: h.score,
    }))

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-base text-gray-600 mt-1">
            {profile?.full_name} • FAMMS - Factory Asset & Maintenance Management
          </p>
        </div>
        <Link
          href="/incidents/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-base font-medium rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
        >
          <Plus className="w-5 h-5" /> Lapor Incident
        </Link>
      </div>

      {/* Quick KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Incident Aktif"
          value={openIncidents}
          icon={<AlertCircle className="w-5 h-5" />}
          color="bg-red-50 text-red-700"
        />
        <KPICard
          label="Baru Hari Ini"
          value={newToday}
          icon={<Activity className="w-5 h-5" />}
          color="bg-blue-50 text-blue-700"
        />
        <KPICard
          label="Sedang Perbaikan"
          value={repairing}
          icon={<TrendingDown className="w-5 h-5" />}
          color="bg-yellow-50 text-yellow-700"
        />
        <KPICard
          label="Total Mesin"
          value={machines?.length || 0}
          icon={<Activity className="w-5 h-5" />}
          color="bg-green-50 text-green-700"
        />
      </div>

      {/* KPI Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Response Time"
          value={responseTime ? `${responseTime}m` : '—'}
          icon={<Clock className="w-5 h-5" />}
          desc="Waktu rata-rata respons"
        />
        <MetricCard
          label="Repair Time"
          value={repairTime ? `${repairTime}h` : '—'}
          icon={<Zap className="w-5 h-5" />}
          desc="Durasi rata-rata perbaikan"
        />
        <MetricCard
          label="Downtime"
          value={`${downtime}h`}
          icon={<TrendingDown className="w-5 h-5" />}
          desc="Total downtime 90 hari"
        />
        <MetricCard
          label="First Fix Rate"
          value={`${firstFixRate}%`}
          icon={<Zap className="w-5 h-5" />}
          desc="Permanen fix rate"
        />
      </div>

      {/* Advanced KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          label="Repeat Failure Rate"
          value={`${repeatRate}%`}
          icon={<AlertCircle className="w-5 h-5" />}
          desc="Repeat failure %"
          highlight={repeatRate > 20}
        />
        <MetricCard
          label="PM Compliance"
          value={`${pmCompliance}%`}
          icon={<BarChart3 className="w-5 h-5" />}
          desc="Kepatuhan PM"
        />
        <MetricCard
          label="Total Cost"
          value={formatRupiah(totalCost)}
          icon={<TrendingDown className="w-5 h-5" />}
          desc="Biaya maintenance"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Distribusi Failure</h2>
          <FailureDistributionChart data={failureDistribution} />
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Status Incident</h2>
          <IncidentStatusChart data={statusDistData} />
        </div>
      </div>

      {/* Equipment Health */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">Kesehatan Peralatan</h2>
          <RecalcHealthButton />
        </div>
        <EquipmentHealthChart data={machineHealth} />
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <QuickLink
          href="/incidents"
          label="Incident"
          description="Kelola incident & perbaikan"
        />
        <QuickLink href="/machines" label="Mesin" description="Data master equipment" />
        <QuickLink href="/pm" label="Jadwal PM" description="Preventive maintenance" />
        <QuickLink
          href="/knowledge-base"
          label="Knowledge Base"
          description="Cari riwayat perbaikan"
        />
      </div>

      {/* Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h2 className="text-lg font-bold text-blue-900 mb-2">🚀 FAMMS V1.0 — KPI Dashboard</h2>
        <p className="text-blue-800">
          Response time, diagnosis time, repair time, downtime hours, first fix rate, repeat failure rate, PM compliance.
          Fault tree prevents false positives. Multi-step repairs, temporary vs permanent tracking, RCA auto-trigger.
        </p>
      </div>
    </div>
  )
}

function KPICard({
  label,
  value,
  icon,
  color,
}: {
  label: string
  value: number
  icon: React.ReactNode
  color: string
}) {
  return (
    <div className={`${color} rounded-lg p-6 border border-current border-opacity-20`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium opacity-75">{label}</p>
          <p className="text-3xl font-bold mt-1">{value}</p>
        </div>
        <div className="opacity-50">{icon}</div>
      </div>
    </div>
  )
}

function MetricCard({
  label,
  value,
  icon,
  desc,
  highlight = false,
}: {
  label: string
  value: string
  icon: React.ReactNode
  desc: string
  highlight?: boolean
}) {
  return (
    <div className={`${highlight ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'} rounded-lg border p-5`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase">{label}</p>
          <p className={`text-2xl font-bold mt-2 ${highlight ? 'text-red-700' : 'text-gray-900'}`}>
            {value}
          </p>
          <p className="text-xs text-gray-500 mt-1">{desc}</p>
        </div>
        <div className="text-gray-300">{icon}</div>
      </div>
    </div>
  )
}

function QuickLink({
  href,
  label,
  description,
}: {
  href: string
  label: string
  description: string
}) {
  return (
    <Link
      href={href}
      className="block p-4 border border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors"
    >
      <h3 className="font-bold text-gray-900">{label}</h3>
      <p className="text-sm text-gray-600 mt-1">{description}</p>
    </Link>
  )
}
