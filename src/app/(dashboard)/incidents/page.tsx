import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import IncidentBoard, { BoardRow } from '@/components/incidents/IncidentBoard'
import IncidentsBoardWithSearch from '@/components/incidents/IncidentsBoardWithSearch'
import { OPEN_STATUSES } from '@/lib/incident-display'

export const metadata = { title: 'Board | FAMMS' }

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ factory?: string; filter?: string }>
}) {
  const { factory, filter } = await searchParams
  const user = await getCurrentUser()
  const supabase = await createClient()

  const SELECT = `
    id, incident_no, status, downtime_impact, incident_type,
    title, reporter_name, reported_at, assigned_to, due_date, observation_end_date, photo_count,
    machine:machines(machine_code, machine_name),
    factory:factories(id, name)
  `

  // user.capabilities.boardFull already IS PERMISSIONS.boardFull(user.role)
  // unless a custom role overrides it (see resolveRoleOverlay in lib/auth.ts).
  const isFullBoard = !user || user.capabilities.boardFull

  let rows: BoardRow[]

  // A single "newest 200 of any status" cap silently dropped genuinely-open,
  // long-stuck cases (e.g. 3+ weeks in waiting_parts) once enough newer rows
  // — mostly quickly-closed ones — accumulated past the cap: the case wasn't
  // filtered out, it was never fetched, on every board tab including "全部".
  // Fix: cap OPEN and CLOSED separately. Open work is capped generously (it
  // should never realistically approach this in a healthy factory, but an
  // unbounded query is still not safe to ship); closed history — which is
  // only ever browsed via the 已結案 tab or search, not needed in full — stays
  // capped at 200 recent rows.
  const OPEN_LIMIT = 1000
  const CLOSED_LIMIT = 200

  if (isFullBoard) {
    // Supervisors/managers see the whole board, scoped to their factory.
    // Admins/cross-factory accounts see every factory's cases — `factory`
    // from the URL (the dashboard's per-factory links) is no longer applied
    // as a server-side restriction here; it's only used below to pre-select
    // the board's client-side factory tab, so switching factories on the
    // board itself doesn't need a full page refetch.
    let openQuery = supabase.from('incidents').select(SELECT)
      .in('status', OPEN_STATUSES).order('reported_at', { ascending: false }).limit(OPEN_LIMIT)
    let closedQuery = supabase.from('incidents').select(SELECT)
      .eq('status', 'closed').order('reported_at', { ascending: false }).limit(CLOSED_LIMIT)
    if (user?.factory_id && user.role !== 'admin') {
      openQuery = openQuery.eq('factory_id', user.factory_id)
      closedQuery = closedQuery.eq('factory_id', user.factory_id)
    }

    // Cross-factory assignments must stay visible: a supervisor assigned to a
    // case in another factory still needs it on their board. Fetched as a
    // separate .contains() query — array-contains inside .or() is unreliable
    // in supabase-js (silently drops multi-assignee rows).
    const needsAssignedExtra = !!user && !!user.factory_id && user.role !== 'admin'
    const [openRes, closedRes, assignedRes] = await Promise.all([
      openQuery,
      closedQuery,
      needsAssignedExtra
        ? supabase.from('incidents').select(SELECT)
            .contains('assigned_user_ids', [user!.id])
            .order('reported_at', { ascending: false }).limit(OPEN_LIMIT)
        : Promise.resolve({ data: null }),
    ])
    const byId = new Map<string, BoardRow>()
    for (const r of [...(openRes.data ?? []), ...(closedRes.data ?? []), ...(assignedRes.data ?? [])]) {
      byId.set((r as { id: string }).id, r as unknown as BoardRow)
    }
    rows = [...byId.values()].sort(
      (a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime()
    )
  } else {
    // Technicians (no full-board access) see cases assigned to them OR reported
    // by them — across ALL factories, since they can be assigned cross-factory.
    //
    // Reliable queries merged + deduped, NOT a single
    // .or('assigned_user_ids.cs.{me},...'): the array-contains operator inside
    // .or() is unreliable in supabase-js and silently dropped multi-assignee
    // cases from the board (they were still counted by the nav badge, which uses
    // .contains() — exactly the "assigned to two people → case won't show" bug).
    // .contains() here matches the badge's filter, so board and badge agree.
    // Same open/closed cap split as the full board, for the same reason.
    const [assignedOpenRes, assignedClosedRes, reportedOpenRes, reportedClosedRes] = await Promise.all([
      supabase.from('incidents').select(SELECT)
        .contains('assigned_user_ids', [user!.id]).in('status', OPEN_STATUSES)
        .order('reported_at', { ascending: false }).limit(OPEN_LIMIT),
      supabase.from('incidents').select(SELECT)
        .contains('assigned_user_ids', [user!.id]).eq('status', 'closed')
        .order('reported_at', { ascending: false }).limit(CLOSED_LIMIT),
      supabase.from('incidents').select(SELECT)
        .eq('reported_by_id', user!.id).in('status', OPEN_STATUSES)
        .order('reported_at', { ascending: false }).limit(OPEN_LIMIT),
      supabase.from('incidents').select(SELECT)
        .eq('reported_by_id', user!.id).eq('status', 'closed')
        .order('reported_at', { ascending: false }).limit(CLOSED_LIMIT),
    ])
    const byId = new Map<string, BoardRow>()
    for (const r of [
      ...(assignedOpenRes.data ?? []), ...(assignedClosedRes.data ?? []),
      ...(reportedOpenRes.data ?? []), ...(reportedClosedRes.data ?? []),
    ]) {
      byId.set((r as { id: string }).id, r as unknown as BoardRow)
    }
    rows = [...byId.values()].sort(
      (a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime()
    )
  }

  return <IncidentsBoardWithSearch rows={rows} userRole={user?.role} initialFilter={filter} initialFactory={factory} />
}
