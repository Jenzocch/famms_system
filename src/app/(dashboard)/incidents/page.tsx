import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import IncidentBoard, { BoardRow } from '@/components/incidents/IncidentBoard'
import IncidentsBoardWithSearch from '@/components/incidents/IncidentsBoardWithSearch'

export const metadata = { title: '案件看板 | 維修系統' }

export default async function IncidentsPage() {
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

  // Scope to the user's factory; admins with no factory see everything.
  if (user?.factory_id) query = query.eq('factory_id', user.factory_id)

  const { data: incidents } = await query

  const rows = (incidents ?? []) as unknown as BoardRow[]

  return <IncidentsBoardWithSearch rows={rows} userRole={user?.role} />
}
