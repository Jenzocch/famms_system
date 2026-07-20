'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface PastIncident {
  id: string
  incident_no: string
  title: string
  status: string
  reported_at: string
}

export interface KBMatch {
  id: string
  problem: string
  repair_method: string
}

// Surfaces past experience at the moment it's needed: while a technician
// fills the report form. Two independent signals, merged:
//   1. Machine history — the moment a machine is picked, its recent incidents
//      and any KB entries written from that machine's incidents.
//   2. Keyword match — as the problem title is typed (debounced), KB entries
//      whose problem/keywords/repair text match.
// Both are best-effort: failures just mean no suggestions, never an error.
export function usePastRecords(machineId: string | null | undefined, queryText: string) {
  const [machineIncidents, setMachineIncidents] = useState<PastIncident[]>([])
  const [machineKb, setMachineKb] = useState<KBMatch[]>([])
  const [textKb, setTextKb] = useState<KBMatch[]>([])

  // Signal 1: machine picked → its history.
  useEffect(() => {
    if (!machineId) {
      // Intentional reset-before-refetch: clears stale suggestions
      // synchronously so the previous machine's history doesn't linger while
      // the new machine's (or no machine's) history loads.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMachineIncidents([])
      setMachineKb([])
      return
    }
    let cancelled = false
    const supabase = createClient()
    ;(async () => {
      const [{ data: incidents }, { data: kb }] = await Promise.all([
        supabase
          .from('incidents')
          .select('id, incident_no, title, status, reported_at')
          .eq('machine_id', machineId)
          .order('reported_at', { ascending: false })
          .limit(3),
        supabase
          .from('knowledge_base')
          .select('id, problem, repair_method, incident:incidents!inner(machine_id)')
          .eq('incident.machine_id', machineId)
          .order('created_at', { ascending: false })
          .limit(3),
      ])
      if (cancelled) return
      setMachineIncidents((incidents as PastIncident[]) ?? [])
      setMachineKb(((kb ?? []) as unknown as KBMatch[]).map(({ id, problem, repair_method }) => ({ id, problem, repair_method })))
    })().catch(() => { /* suggestions are best-effort */ })
    return () => { cancelled = true }
  }, [machineId])

  // Signal 2: typed problem text → KB keyword match (debounced 500ms).
  useEffect(() => {
    const q = queryText.trim()
    if (q.length < 2) {
      // Intentional reset-before-refetch (see machine-history effect above).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTextKb([])
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      const supabase = createClient()
      // Escape PostgREST or-filter specials so user text can't break the query.
      const term = `%${q.replace(/[%_,().]/g, ' ').trim()}%`
      const { data } = await supabase
        .from('knowledge_base')
        .select('id, problem, repair_method')
        .or(`problem.ilike.${term},keywords.ilike.${term},repair_method.ilike.${term}`)
        .limit(3)
      if (!cancelled) setTextKb((data as KBMatch[]) ?? [])
    }, 500)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [queryText])

  // Merge KB lists, machine-based first, dedupe by id.
  const seen = new Set<string>()
  const kbEntries = [...machineKb, ...textKb].filter(e => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    return true
  }).slice(0, 4)

  return { pastIncidents: machineIncidents, kbEntries }
}
