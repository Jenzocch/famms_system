import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, PERMISSIONS } from '@/lib/auth'
import IncidentBoard, { BoardRow } from '@/components/incidents/IncidentBoard'
import IncidentsBoardWithSearch from '@/components/incidents/IncidentsBoardWithSearch'

export const metadata = { title: '案件看板 | 維修系統' }

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ factory?: string }>
}) {
  const { factory } = await searchParams
  const user = await getCurrentUser()
  const supabase = await createClient()

  let query = supabase
    .from('incidents')
    .select(`
      id, incident_no, status, downtime_impact, incident_type,
      title, reporter_name, reported_at, assigned_to, due_date,
      machine:machines(machine_code, machine_name),
      factory:factories(name)
    `)
    .order('reported_at', { ascending: false })
    .limit(200)

  // Scope to the user's factory. Admins see every factory's cases.
  if (user?.factory_id && user.role !== 'admin') query = query.eq('factory_id', user.factory_id)

  // Optional factory filter from the dashboard's per-factory rows.
  if (factory) query = query.eq('factory_id', factory)

  // Technicians (no full-board access) only see cases assigned to them.
  if (user && !PERMISSIONS.boardFull(user.role)) {
    query = query.contains('assigned_user_ids', [user.id])
  }

  const { data: incidents } = await query

  const rows = (incidents ?? []) as unknown as BoardRow[]

  return <IncidentsBoardWithSearch rows={rows} userRole={user?.role} />
}
