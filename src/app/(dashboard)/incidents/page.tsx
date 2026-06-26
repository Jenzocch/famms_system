import { createClient } from '@/lib/supabase/server'
import IncidentBoard, { BoardRow } from '@/components/incidents/IncidentBoard'

export const metadata = { title: '案件看板 | 維修系統' }

export default async function IncidentsPage() {
  const supabase = await createClient()
  const { data: incidents } = await supabase
    .from('incidents')
    .select(`
      id, incident_no, status, downtime_impact, incident_type,
      title, reporter_name, reported_at,
      machine:machines(machine_code, machine_name),
      factory:factories(name)
    `)
    .order('reported_at', { ascending: false })
    .limit(200)

  const rows = (incidents ?? []) as unknown as BoardRow[]

  return <IncidentBoard rows={rows} />
}
