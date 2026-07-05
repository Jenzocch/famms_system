import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, PERMISSIONS } from '@/lib/auth'
import IncidentBoard, { BoardRow } from '@/components/incidents/IncidentBoard'
import IncidentsBoardWithSearch from '@/components/incidents/IncidentsBoardWithSearch'

export const metadata = { title: 'Board | FAMMS' }

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

  const isFullBoard = !user || PERMISSIONS.boardFull(user.role)

  if (isFullBoard) {
    // Admins see every factory's cases.
    if (factory) {
      // Explicit factory drill-down from the dashboard's per-factory rows.
      query = query.eq('factory_id', factory)
    } else if (user?.factory_id && user.role !== 'admin') {
      // Supervisors/managers see their own factory PLUS any case assigned to
      // them in another factory (cross-factory assignments must stay visible).
      query = query.or(`factory_id.eq.${user.factory_id},assigned_user_ids.cs.{${user.id}}`)
    }
  } else {
    // Technicians (no full-board access) see cases assigned to them OR reported
    // by them — across ALL factories, since they can be assigned cross-factory.
    // No factory .eq() here, so this matches the nav badge count (which also
    // ignores factory); otherwise an assigned case in another factory would be
    // counted in the badge but hidden from the board. Canonical PostgREST
    // array-contains (assigned_user_ids @> {me}) makes multi-assignee match.
    query = query.or(`assigned_user_ids.cs.{${user.id}},reported_by_id.eq.${user.id}`)
  }

  const { data: incidents } = await query

  const rows = (incidents ?? []) as unknown as BoardRow[]

  return <IncidentsBoardWithSearch rows={rows} userRole={user?.role} />
}
