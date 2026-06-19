import { createClient } from '@/lib/supabase/server'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import RequestCard from '@/components/dashboard/RequestCard'
import { RequestStatus, PurchaseRequest } from '@/types'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

const TABS: { value: string; label: string; statuses: RequestStatus[] }[] = [
  {
    value: 'pending',
    label: 'Pending',
    statuses: ['pending_dept_manager', 'pending_general_manager', 'pending_director'],
  },
  { value: 'inprogress', label: 'In Progress', statuses: ['draft', 'returned'] },
  { value: 'approved', label: 'Approved', statuses: ['approved'] },
  { value: 'rejected', label: 'Rejected', statuses: ['rejected'] },
]

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user!.id).single()
  const isApprover = ['dept_manager', 'general_manager', 'director', 'purchasing'].includes(profile?.role ?? '')

  const baseQuery = supabase
    .from('purchase_requests')
    .select(`*, department:departments(id,name), applicant:profiles!applicant_id(id,full_name), images:request_images(id,storage_path,sort_order)`)
    .order('updated_at', { ascending: false })

  const query = isApprover ? baseQuery : baseQuery.eq('applicant_id', user!.id)
  const { data: requests } = await query

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  const grouped = (statuses: RequestStatus[]) =>
    (requests as PurchaseRequest[] ?? []).filter(r => statuses.includes(r.status))

  const pendingForMe = isApprover
    ? (requests as PurchaseRequest[] ?? []).filter(r => {
        if (profile?.role === 'dept_manager') return r.status === 'pending_dept_manager'
        if (profile?.role === 'general_manager') return r.status === 'pending_general_manager'
        if (profile?.role === 'director') return r.status === 'pending_director'
        return false
      })
    : []

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-base text-gray-600 mt-1">Procurement Decision Platform</p>
        </div>
        <Link href="/requests/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-base font-medium rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap">
          <Plus className="w-5 h-5" /> New Request
        </Link>
      </div>

      {isApprover && pendingForMe.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-bold text-red-700 flex items-center gap-2">
            <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            ⚠️ Awaiting Your Approval ({pendingForMe.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {pendingForMe.map(r => (
              <RequestCard key={r.id} request={r} supabaseUrl={supabaseUrl} />
            ))}
          </div>
        </section>
      )}

      <Tabs defaultValue="pending" className="space-y-4">
        <TabsList className="grid grid-cols-4 w-full h-auto gap-1 p-1.5 bg-gray-100">
          {TABS.map(tab => (
            <TabsTrigger key={tab.value} value={tab.value} className="py-3 text-sm sm:text-base font-semibold">
              <div className="flex flex-col items-center gap-1">
                <span>{tab.label}</span>
                {grouped(tab.statuses).length > 0 && (
                  <span className="bg-red-500 text-white rounded-full px-2 py-0.5 text-xs font-bold">
                    {grouped(tab.statuses).length}
                  </span>
                )}
              </div>
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map(tab => (
          <TabsContent key={tab.value} value={tab.value} className="space-y-6">
            {grouped(tab.statuses).length === 0 ? (
              <div className="text-center py-20 text-gray-400">
                <p className="text-lg text-gray-500">No requests here</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {grouped(tab.statuses).map(r => (
                  <RequestCard key={r.id} request={r} supabaseUrl={supabaseUrl} />
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
