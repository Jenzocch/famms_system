import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Plus, AlertCircle, Activity, TrendingDown } from 'lucide-react'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, factory_id')
    .eq('id', user.id)
    .single()

  const { data: incidents } = await supabase
    .from('incidents')
    .select('status, created_at')
    .eq('factory_id', profile?.factory_id)
    .order('created_at', { ascending: false })
    .limit(100)

  const { data: machines } = await supabase
    .from('machines')
    .select('id, status')
    .eq('factory_id', profile?.factory_id)

  const openIncidents = incidents?.filter(i => !['closed'].includes(i.status)).length || 0
  const newToday = incidents?.filter(i => {
    const today = new Date().toISOString().split('T')[0]
    return i.created_at.startsWith(today)
  }).length || 0
  const repairing = machines?.filter(m => m.status === 'repairing').length || 0

  return (
    <div className="space-y-8">
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
          <Plus className="w-5 h-5" /> New Incident
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Open Incidents"
          value={openIncidents}
          icon={<AlertCircle className="w-5 h-5" />}
          color="bg-red-50 text-red-700"
        />
        <KPICard
          label="New Today"
          value={newToday}
          icon={<Activity className="w-5 h-5" />}
          color="bg-blue-50 text-blue-700"
        />
        <KPICard
          label="Repairing"
          value={repairing}
          icon={<TrendingDown className="w-5 h-5" />}
          color="bg-yellow-50 text-yellow-700"
        />
        <KPICard
          label="Total Machines"
          value={machines?.length || 0}
          icon={<Activity className="w-5 h-5" />}
          color="bg-green-50 text-green-700"
        />
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <QuickLink
          href="/incidents"
          label="Incidents"
          description="Manage incidents & repairs"
        />
        <QuickLink href="/machines" label="Machines" description="Equipment master data" />
        <QuickLink href="/pm" label="PM Schedule" description="Preventive maintenance" />
        <QuickLink
          href="/knowledge-base"
          label="Knowledge Base"
          description="Search repair history"
        />
      </div>

      {/* Coming Soon */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h2 className="text-lg font-bold text-blue-900 mb-2">🚀 FAMMS V1.0</h2>
        <p className="text-blue-800">
          Equipment maintenance system designed for SJA, DIN, and Olentia. Track incidents with
          multi-step repair workflows, detect repeat failures without false positives via fault
          tree, and drive decision-making with KPI dashboards.
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
